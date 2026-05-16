-- L.4b — Libro IVA Compras (RG 1361).
--
-- Espejo de L.4a (ventas) pero para purchase_invoices recibidas.
-- Mismas reglas:
--   * Solo channel.is_fiscal = true (los internos = "gasto sin factura"
--     no van al libro IVA).
--   * Solo status = 'received'. Los cancelled no se listan.
--   * Filtra por fecha del comprobante dentro del mes.
--
-- Para comprobantes sin items (la gran mayoría de los 1313 import AFIP
-- antes de K.8), emitimos fila ficticia con iva_rate_id = null + neto/iva
-- del header. El front los marca para que el contador los desglose.

set row_security = off;

create or replace function public.libro_iva_compras(
  p_period text,
  p_channel_id text default null
)
returns table (
  purchase_invoice_id  uuid,
  fecha                date,
  kind                 text,
  letter               char(1),
  punto_venta          int,
  numero               int,
  supplier_legal_name  text,
  supplier_cuit        text,
  cae_proveedor        text,
  cae_vto_proveedor    date,
  iva_rate_id          int,
  iva_rate_pct         numeric,
  neto                 numeric,
  iva                  numeric,
  imp_trib             numeric,
  imp_total            numeric,
  channel_id           text,
  channel_name         text,
  has_items            boolean
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'libro_iva_compras: período inválido (esperado YYYY-MM, got %)', p_period
      using errcode = '22023';
  end if;

  return query
  with periodo as (
    select
      to_date(p_period || '-01', 'YYYY-MM-DD')                                      as desde,
      (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date as hasta
  ),
  fiscal_pis as (
    select p.*
      from public.purchase_invoices p
      join public.invoicing_channels c on c.id = p.channel_id
     where c.is_fiscal = true
       and p.status = 'received'
       and p.fecha between (select desde from periodo) and (select hasta from periodo)
       and (p_channel_id is null or p.channel_id = p_channel_id)
  ),
  per_pi_rate as (
    select
      p.id              as pi_id,
      it.iva_rate_id    as iva_rate_id,
      sum(it.line_neto) as neto_sum,
      sum(it.line_iva)  as iva_sum
    from fiscal_pis p
    join public.purchase_invoice_items it on it.purchase_invoice_id = p.id
    group by p.id, it.iva_rate_id
  ),
  pis_sin_items as (
    select p.id, p.imp_neto, p.imp_iva
      from fiscal_pis p
      left join public.purchase_invoice_items it on it.purchase_invoice_id = p.id
     where it.id is null
     group by p.id, p.imp_neto, p.imp_iva
  ),
  combined as (
    select pir.pi_id, pir.iva_rate_id, pir.neto_sum as neto, pir.iva_sum as iva, true as has_items
      from per_pi_rate pir
    union all
    select psi.id, null::int, psi.imp_neto, psi.imp_iva, false
      from pis_sin_items psi
  )
  select
    p.id,
    p.fecha,
    p.kind,
    p.letter,
    p.punto_venta,
    p.numero,
    coalesce(s.legal_name, '—')                  as supplier_legal_name,
    s.cuit                                       as supplier_cuit,
    p.cae_proveedor,
    p.cae_vto_proveedor,
    cb.iva_rate_id,
    case cb.iva_rate_id
      when 3 then 0
      when 4 then 10.5
      when 5 then 21
      when 6 then 27
      when 8 then 5
      when 9 then 2.5
      else null
    end::numeric                                  as iva_rate_pct,
    cb.neto,
    cb.iva,
    p.imp_trib,
    p.imp_total,
    p.channel_id,
    ch.name                                       as channel_name,
    cb.has_items
  from combined cb
  join fiscal_pis p on p.id = cb.pi_id
  left join public.suppliers s on s.id = p.supplier_id
  join public.invoicing_channels ch on ch.id = p.channel_id
  order by p.fecha asc, p.letter nulls last, p.numero asc, cb.iva_rate_id asc nulls last;
end;
$$;

comment on function public.libro_iva_compras(text, text) is
  'Libro IVA Compras RG 1361. Devuelve una fila por (purchase_invoice × alícuota). Solo fiscal + status received.';

revoke all on function public.libro_iva_compras(text, text) from public;
grant execute on function public.libro_iva_compras(text, text) to authenticated;

set row_security = on;
