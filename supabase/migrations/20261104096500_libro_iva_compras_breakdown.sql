SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- libro_iva_compras (from 20261031184339) with exento, no gravado and the four
-- tributes, in pesos and in the document's currency, repeated on every
-- alícuota row like imp_trib. The return type changes, so drop + create; the
-- columns are appended, and callers that name what they read keep working.

-- squawk-ignore ban-drop-function
drop function public.libro_iva_compras(text, text);

create function public.libro_iva_compras(
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
  has_items            boolean,
  moneda               text,
  cotizacion           numeric,
  neto_orig            numeric,
  iva_orig             numeric,
  imp_trib_orig        numeric,
  imp_total_orig       numeric,
  no_gravado              numeric,
  exentas                 numeric,
  perc_iva                numeric,
  perc_iibb               numeric,
  perc_municipales        numeric,
  impuestos_internos      numeric,
  no_gravado_orig         numeric,
  exentas_orig            numeric,
  perc_iva_orig           numeric,
  perc_iibb_orig          numeric,
  perc_municipales_orig   numeric,
  impuestos_internos_orig numeric
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

  if p_channel_id is not null and not exists (
    select 1 from public.invoicing_channels c
    where c.id = p_channel_id and c.is_fiscal
  ) then
    raise exception 'El libro IVA solo incluye canales fiscales.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  return query
  with periodo as (
    select
      to_date(p_period || '-01', 'YYYY-MM-DD')                                      as desde,
      (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date as hasta
  ),
  fiscal_pis as (
    select
      p.id, p.fecha, p.kind, p.letter, p.punto_venta, p.numero, p.supplier_id,
      p.cae_proveedor, p.cae_vto_proveedor, p.imp_neto, p.imp_iva, p.imp_trib,
      p.imp_total, p.channel_id, p.moneda,
      p.imp_no_gravado, p.imp_op_exentas, p.imp_perc_iva, p.imp_perc_iibb,
      p.imp_perc_municipales, p.imp_impuestos_internos,
      case
        when p.moneda is null or p.moneda = 'PES' then 1::numeric
        else coalesce(
          nullif(p.cotizacion, 0),
          public.get_exchange_rate('USD', p.fecha),
          1
        )
      end as fx
      from public.purchase_invoices p
      join public.invoicing_channels c on c.id = p.channel_id
     where c.is_fiscal = true
       and p.status = 'received'
       and p.fecha between (select desde from periodo) and (select hasta from periodo)
       and (p_channel_id is null or p.channel_id = p_channel_id)
  ),
  -- Document totals in pesos, each component rounded like the journal entry;
  -- trib is the sum of the four rounded tributes, as the supplier line is.
  doc_parts as (
    select
      f.id,
      round(f.imp_neto * f.fx, 2) as neto,
      round(f.imp_iva * f.fx, 2)  as iva,
      round(f.imp_no_gravado * f.fx, 2)         as no_gravado,
      round(f.imp_op_exentas * f.fx, 2)         as exentas,
      round(f.imp_perc_iva * f.fx, 2)           as perc_iva,
      round(f.imp_perc_iibb * f.fx, 2)          as perc_iibb,
      round(f.imp_perc_municipales * f.fx, 2)   as perc_municipales,
      round(f.imp_impuestos_internos * f.fx, 2) as impuestos_internos
    from fiscal_pis f
  ),
  doc_ars as (
    select
      dp.*,
      dp.perc_iva + dp.perc_iibb + dp.perc_municipales + dp.impuestos_internos as trib
    from doc_parts dp
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
  ),
  -- Each alícuota row rounded on its own; the largest row of the document
  -- takes the cent difference against the document total.
  rounded as (
    select
      cb.*,
      round(cb.neto * p.fx, 2) as neto_r,
      round(cb.iva * p.fx, 2)  as iva_r,
      sum(round(cb.neto * p.fx, 2)) over w as neto_r_sum,
      sum(round(cb.iva * p.fx, 2)) over w  as iva_r_sum,
      row_number() over (w order by abs(cb.neto) desc, cb.iva_rate_id nulls last) as neto_rank,
      row_number() over (w order by abs(cb.iva) desc, cb.iva_rate_id nulls last)  as iva_rank
    from combined cb
    join fiscal_pis p on p.id = cb.pi_id
    window w as (partition by cb.pi_id)
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
    cb.neto_r + case when cb.neto_rank = 1 then d.neto - cb.neto_r_sum else 0 end,
    cb.iva_r + case when cb.iva_rank = 1 then d.iva - cb.iva_r_sum else 0 end,
    d.trib,
    d.neto + d.no_gravado + d.exentas + d.iva + d.trib,
    p.channel_id,
    ch.name                                       as channel_name,
    cb.has_items,
    p.moneda,
    p.fx,
    cb.neto,
    cb.iva,
    p.imp_trib,
    p.imp_total,
    d.no_gravado,
    d.exentas,
    d.perc_iva,
    d.perc_iibb,
    d.perc_municipales,
    d.impuestos_internos,
    p.imp_no_gravado,
    p.imp_op_exentas,
    p.imp_perc_iva,
    p.imp_perc_iibb,
    p.imp_perc_municipales,
    p.imp_impuestos_internos
  from rounded cb
  join fiscal_pis p on p.id = cb.pi_id
  join doc_ars d on d.id = cb.pi_id
  left join public.suppliers s on s.id = p.supplier_id
  join public.invoicing_channels ch on ch.id = p.channel_id
  order by p.fecha asc, p.letter nulls last, p.numero asc, cb.iva_rate_id asc nulls last;
end;
$$;

comment on function public.libro_iva_compras(text, text) is
  'Libro IVA Compras RG 1361, en pesos. Una fila por (purchase_invoice × alícuota); solo fiscal + status received. Importes en ARS con la misma conversión y redondeo que el asiento del comprobante (imp_total = suma de componentes redondeados: neto, no gravado, exento, IVA y los cuatro tributos); *_orig en la moneda del comprobante.';

revoke all on function public.libro_iva_compras(text, text) from public, anon, authenticated;
grant execute on function public.libro_iva_compras(text, text) to authenticated;
