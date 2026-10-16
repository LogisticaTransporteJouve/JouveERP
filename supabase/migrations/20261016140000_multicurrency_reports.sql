-- Multicurrency reports: the libro IVA in pesos and the aging split by currency.
--
-- 1. libro_iva_ventas / libro_iva_compras. The libro IVA is kept in pesos: every
--    amount column (neto, iva, imp_*) is now the document's amount × its own
--    cotizacion (the one reported to AFIP), rounded to 2 decimals per field.
--    Before, a USD comprobante entered the book and its totals at face value.
--    The original-currency amounts stay available as *_orig, with moneda and
--    cotizacion, for traceability and for the Libro IVA Digital TXT, which
--    reports amounts in the comprobante's currency plus the exchange rate.
--    The return type changes, so each function is dropped and recreated.
--
-- 2. v_client_aging / v_supplier_aging. The buckets summed open_amount across
--    currencies (a USD invoice counted as pesos). They now expose ARS and USD
--    separately (usd_* = moneda DOL/USD, ars_* = the rest; the app only issues
--    PES and DOL); the caller converts USD at the latest official rate when it
--    needs a single figure. Column names change, so both views are
--    dropped and recreated (nothing in the database depends on them).

set row_security = off;

------------------------------------------------------------------------------
-- 1a. Libro IVA Ventas
------------------------------------------------------------------------------

drop function public.libro_iva_ventas(text, text);

create function public.libro_iva_ventas(
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
  has_items            boolean,
  moneda               text,
  cotizacion           numeric,
  neto_orig            numeric,
  iva_orig             numeric,
  imp_trib_orig        numeric,
  imp_op_ex_orig       numeric,
  imp_tot_conc_orig    numeric,
  imp_total_orig       numeric
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
    select
      i.id, i.fecha, i.kind, i.letter, i.punto_venta, i.numero,
      i.cbte_tipo_afip, i.client_id, i.doc_tipo, i.doc_nro, i.cae,
      i.cae_vencimiento, i.imp_neto, i.imp_iva, i.imp_trib, i.imp_op_ex,
      i.imp_tot_conc, i.imp_total, i.channel_id, i.moneda,
      case
        when i.moneda = 'PES' then 1::numeric
        else coalesce(nullif(i.cotizacion, 0), 1)
      end as fx
      from public.invoices i
      join public.invoicing_channels c on c.id = i.channel_id
     where c.is_fiscal = true
       and i.status = 'emitted'
       and i.fecha between (select desde from periodo) and (select hasta from periodo)
       and (p_channel_id is null or i.channel_id = p_channel_id)
  ),
  -- Items grouped per (invoice, iva_rate_id). An invoice without items yields
  -- one row with iva_rate_id null and the header neto/iva.
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
    round(cb.neto * i.fx, 2),
    round(cb.iva * i.fx, 2),
    round(i.imp_trib * i.fx, 2),
    round(i.imp_op_ex * i.fx, 2),
    round(i.imp_tot_conc * i.fx, 2),
    round(i.imp_total * i.fx, 2),
    i.channel_id,
    ch.name                                       as channel_name,
    cb.has_items,
    i.moneda,
    i.fx,
    cb.neto,
    cb.iva,
    i.imp_trib,
    i.imp_op_ex,
    i.imp_tot_conc,
    i.imp_total
  from combined cb
  join fiscal_invs i on i.id = cb.invoice_id
  left join public.clients cl on cl.id = i.client_id
  join public.invoicing_channels ch on ch.id = i.channel_id
  order by i.fecha asc, i.cbte_tipo_afip asc, i.numero asc, cb.iva_rate_id asc nulls last;
end;
$$;

comment on function public.libro_iva_ventas(text, text) is
  'Libro IVA Ventas RG 1361, en pesos. Una fila por (comprobante × alícuota) para un período YYYY-MM, opcionalmente filtrado por canal; solo fiscal + emitted. Importes en ARS (importe × cotizacion del comprobante, redondeado a 2 decimales); *_orig en la moneda del comprobante.';

revoke all on function public.libro_iva_ventas(text, text) from public, anon, authenticated;
grant execute on function public.libro_iva_ventas(text, text) to authenticated;

------------------------------------------------------------------------------
-- 1b. Libro IVA Compras
------------------------------------------------------------------------------

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
  imp_total_orig       numeric
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
    select
      p.id, p.fecha, p.kind, p.letter, p.punto_venta, p.numero, p.supplier_id,
      p.cae_proveedor, p.cae_vto_proveedor, p.imp_neto, p.imp_iva, p.imp_trib,
      p.imp_total, p.channel_id, p.moneda,
      case
        when p.moneda = 'PES' then 1::numeric
        else coalesce(nullif(p.cotizacion, 0), 1)
      end as fx
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
    round(cb.neto * p.fx, 2),
    round(cb.iva * p.fx, 2),
    round(p.imp_trib * p.fx, 2),
    round(p.imp_total * p.fx, 2),
    p.channel_id,
    ch.name                                       as channel_name,
    cb.has_items,
    p.moneda,
    p.fx,
    cb.neto,
    cb.iva,
    p.imp_trib,
    p.imp_total
  from combined cb
  join fiscal_pis p on p.id = cb.pi_id
  left join public.suppliers s on s.id = p.supplier_id
  join public.invoicing_channels ch on ch.id = p.channel_id
  order by p.fecha asc, p.letter nulls last, p.numero asc, cb.iva_rate_id asc nulls last;
end;
$$;

comment on function public.libro_iva_compras(text, text) is
  'Libro IVA Compras RG 1361, en pesos. Una fila por (purchase_invoice × alícuota); solo fiscal + status received. Importes en ARS (importe × cotizacion del comprobante, redondeado a 2 decimales); *_orig en la moneda del comprobante.';

revoke all on function public.libro_iva_compras(text, text) from public, anon, authenticated;
grant execute on function public.libro_iva_compras(text, text) to authenticated;

------------------------------------------------------------------------------
-- 2a. Client aging by currency
------------------------------------------------------------------------------

drop view public.v_client_aging;

create view public.v_client_aging with (security_invoker = on) as
  select
    d.client_id as client_id,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '0_30'), 0) as ars_bucket_0_30,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '30_60'), 0) as ars_bucket_30_60,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '60_90'), 0) as ars_bucket_60_90,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '90_plus'), 0) as ars_bucket_90_plus,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD')), 0) as ars_total_open,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '0_30'), 0) as usd_bucket_0_30,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '30_60'), 0) as usd_bucket_30_60,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '60_90'), 0) as usd_bucket_60_90,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '90_plus'), 0) as usd_bucket_90_plus,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD')), 0) as usd_total_open,
    count(*) as document_count,
    max(d.days_overdue) as oldest_days
  from public.v_aging_documents d
  group by d.client_id;

comment on view public.v_client_aging is
  'Aging agregado por cliente, separado por moneda: ars_* (pesos) y usd_* (dólares). Nunca suma monedas distintas. Permiso: clients:read.';

------------------------------------------------------------------------------
-- 2b. Supplier aging by currency
------------------------------------------------------------------------------

drop view public.v_supplier_aging;

create view public.v_supplier_aging with (security_invoker = on) as
  select
    d.supplier_id as supplier_id,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '0_30'), 0) as ars_bucket_0_30,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '30_60'), 0) as ars_bucket_30_60,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '60_90'), 0) as ars_bucket_60_90,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '90_plus'), 0) as ars_bucket_90_plus,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD')), 0) as ars_total_open,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '0_30'), 0) as usd_bucket_0_30,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '30_60'), 0) as usd_bucket_30_60,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '60_90'), 0) as usd_bucket_60_90,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '90_plus'), 0) as usd_bucket_90_plus,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD')), 0) as usd_total_open,
    count(*) as document_count,
    max(d.days_overdue) as oldest_days
  from public.v_supplier_aging_documents d
  group by d.supplier_id;

comment on view public.v_supplier_aging is
  'Aging agregado por proveedor, separado por moneda: ars_* (pesos) y usd_* (dólares). Nunca suma monedas distintas. Permiso: suppliers:read.';

set row_security = on;
