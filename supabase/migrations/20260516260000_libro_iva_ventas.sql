-- L.4a — Libro IVA Ventas (RG 1361).
--
-- RPC que arma el libro IVA Ventas para un período (YYYY-MM) y opcionalmente
-- filtra por canal. Solo lista comprobantes:
--   * con channel.is_fiscal = true (los internos no van al libro IVA),
--   * con status = 'emitted',
--   * dentro del mes pedido (fecha del comprobante).
--
-- Devuelve UNA fila por (comprobante × alícuota) — el front la agrupa para
-- mostrar el formato libro IVA tradicional (una fila por comprobante con
-- columnas por alícuota). Esto es más flexible que devolver columnas
-- precomputadas: el contador puede pedir reportes con cualquier set de
-- alícuotas.
--
-- Para los comprobantes sin items (caso legacy AFIP imports antes de K.8),
-- emitimos una "fila ficticia" con iva_rate_id = null y los importes del
-- header. El front los marca como "sin desglose" en amarillo para que el
-- contador los detecte y los complete.
--
-- Sumarizadores: el front los calcula desde las filas devueltas.

set row_security = off;

create or replace function public.libro_iva_ventas(
  p_period text,
  p_channel_id text default null
)
returns table (
  invoice_id           uuid,
  fecha                date,
  kind                 text,
  letter               char(1),
  punto_venta          int,
  numero               int,
  cbte_tipo_afip       int,
  client_legal_name    text,
  doc_tipo             int,
  doc_nro              text,
  cae                  text,
  cae_vencimiento      date,
  iva_rate_id          int,
  iva_rate_pct         numeric,
  neto                 numeric,
  iva                  numeric,
  imp_trib             numeric,
  imp_op_ex            numeric,
  imp_tot_conc         numeric,
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
    raise exception 'libro_iva_ventas: período inválido (esperado YYYY-MM, got %)', p_period
      using errcode = '22023';
  end if;

  return query
  with periodo as (
    select
      to_date(p_period || '-01', 'YYYY-MM-DD')                          as desde,
      (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date as hasta
  ),
  fiscal_invs as (
    select i.*
      from public.invoices i
      join public.invoicing_channels c on c.id = i.channel_id
     where c.is_fiscal = true
       and i.status = 'emitted'
       and i.fecha between (select desde from periodo) and (select hasta from periodo)
       and (p_channel_id is null or i.channel_id = p_channel_id)
  ),
  -- Agrupamos items por (invoice, iva_rate_id). Si no hay items emitimos
  -- fila ficticia (iva_rate_id null + neto/iva del header).
  per_invoice_rate as (
    select
      i.id              as invoice_id,
      it.iva_rate_id    as iva_rate_id,
      sum(it.line_neto) as neto_sum,
      sum(it.line_iva)  as iva_sum
    from fiscal_invs i
    join public.invoice_items it on it.invoice_id = i.id
    group by i.id, it.iva_rate_id
  ),
  invs_sin_items as (
    select i.id, i.imp_neto, i.imp_iva
      from fiscal_invs i
      left join public.invoice_items it on it.invoice_id = i.id
     where it.id is null
     group by i.id, i.imp_neto, i.imp_iva
  ),
  combined as (
    select
      pir.invoice_id, pir.iva_rate_id,
      pir.neto_sum as neto, pir.iva_sum as iva,
      true as has_items
    from per_invoice_rate pir
    union all
    select
      isi.id, null::int,
      isi.imp_neto, isi.imp_iva,
      false
    from invs_sin_items isi
  )
  select
    i.id,
    i.fecha,
    i.kind,
    i.letter,
    i.punto_venta,
    i.numero,
    i.cbte_tipo_afip,
    coalesce(cl.legal_name, '—')                  as client_legal_name,
    i.doc_tipo,
    i.doc_nro,
    i.cae,
    i.cae_vencimiento,
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
    i.imp_trib,
    i.imp_op_ex,
    i.imp_tot_conc,
    i.imp_total,
    i.channel_id,
    ch.name                                       as channel_name,
    cb.has_items
  from combined cb
  join fiscal_invs i on i.id = cb.invoice_id
  left join public.clients cl on cl.id = i.client_id
  join public.invoicing_channels ch on ch.id = i.channel_id
  order by i.fecha asc, i.cbte_tipo_afip asc, i.numero asc, cb.iva_rate_id asc nulls last;
end;
$$;

comment on function public.libro_iva_ventas(text, text) is
  'Libro IVA Ventas RG 1361. Devuelve una fila por (comprobante × alícuota) para un período YYYY-MM, opcionalmente filtrado por canal. Solo lista fiscal + emitted dentro del mes.';

revoke all on function public.libro_iva_ventas(text, text) from public;
grant execute on function public.libro_iva_ventas(text, text) to authenticated;

set row_security = on;
