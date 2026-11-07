SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Conciliación con ARCA (compras): same outputs, signatures and grants as
-- 20261106223000; only purchase_arca_reconciliation_rows() changes how it
-- matches. It looked up each voucher's purchase with a lateral subquery whose
-- `id = link OR key = key` filter ran against the materialized fiscal CTE (a
-- CTE has no index), so every voucher scanned every purchase: ~8.5k × ~8.5k
-- rows, 14 s in production, and the page timed out. Now the link and the key
-- are two hash left joins and DISTINCT ON keeps one key candidate per voucher
-- (same letter first, else a purchase loaded without letter); the link still
-- wins over the key. months() and detail() already call rows() once each.
--
-- No new index: rows() reads both tables whole (every non-discarded voucher,
-- every fiscal purchase), where a hash join beats any index, and detail()'s
-- lookups use the primary keys and suppliers_cuit_key.
--
-- No data change. Rollback: older code calls the same signatures.

create or replace function public.purchase_arca_reconciliation_rows()
returns table (
  voucher_id          uuid,
  purchase_invoice_id uuid,
  arca_fecha          date,
  erp_fecha           date,
  arca_comparable     boolean,
  arca_neto           numeric,
  arca_iva            numeric,
  arca_trib           numeric,
  arca_total          numeric,
  erp_neto            numeric,
  erp_iva             numeric,
  erp_trib            numeric,
  erp_total           numeric,
  totals_differ       boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with fiscal as materialized (
    select p.id, s.cuit, p.kind, p.letter, p.punto_venta, p.numero, p.fecha,
           p.moneda, p.cotizacion, p.imp_neto, p.imp_iva, p.imp_trib, p.imp_total
      from public.purchase_invoices p
      join public.invoicing_channels c on c.id = p.channel_id and c.is_fiscal
      join public.suppliers s on s.id = p.supplier_id
     where p.status <> 'cancelled'
  ),
  vouchers as materialized (
    select v.id, v.fecha, v.kind, v.letter, v.issuer_cuit, v.punto_venta, v.numero,
           v.purchase_invoice_id, v.moneda, v.cotizacion,
           v.imp_neto_gravado, v.imp_iva, v.imp_trib, v.imp_total,
           v.kind is not null and v.unreadable_reason is null as comparable
      from public.arca_received_vouchers v
     where v.status <> 'discarded'
  ),
  matched as materialized (
    select distinct on (v.id) v.*, coalesce(l.id, k.id) as purchase_id
      from vouchers v
      left join fiscal l on l.id = v.purchase_invoice_id
      left join fiscal k
        on k.cuit = v.issuer_cuit and k.kind = v.kind
       and k.punto_venta = v.punto_venta and k.numero = v.numero
       and (k.letter = v.letter or k.letter is null)
     order by v.id, k.letter = v.letter desc nulls last, k.id
  ),
  pairs as (
    select m.*,
           row_number() over (partition by m.purchase_id order by m.fecha, m.id) as purchase_rn
      from matched m
  )
  select x.voucher_id, x.purchase_invoice_id, x.arca_fecha, x.erp_fecha,
         x.arca_comparable,
         x.arca_neto, x.arca_iva, x.arca_trib, x.arca_total,
         x.erp_neto, x.erp_iva, x.erp_trib, x.erp_total,
         x.totals_differ
    from (
      select pr.id as voucher_id,
             pr.purchase_id as purchase_invoice_id,
             pr.fecha as arca_fecha,
             case when pr.purchase_rn = 1 then f.fecha end as erp_fecha,
             pr.comparable as arca_comparable,
             case when pr.comparable then va.sign * pr.imp_neto_gravado * va.rate end as arca_neto,
             case when pr.comparable then va.sign * pr.imp_iva * va.rate end as arca_iva,
             case when pr.comparable then va.sign * pr.imp_trib * va.rate end as arca_trib,
             case when pr.comparable then va.sign * pr.imp_total * va.rate end as arca_total,
             case when pr.purchase_rn = 1 then fa.sign * f.imp_neto * fa.rate end as erp_neto,
             case when pr.purchase_rn = 1 then fa.sign * f.imp_iva * fa.rate end as erp_iva,
             case when pr.purchase_rn = 1 then fa.sign * f.imp_trib * fa.rate end as erp_trib,
             case when pr.purchase_rn = 1 then fa.sign * f.imp_total * fa.rate end as erp_total,
             coalesce(
               pr.comparable and f.id is not null and (
                 case when pr.moneda = f.moneda
                      then abs(pr.imp_total - f.imp_total)
                      else abs(pr.imp_total * va.rate - f.imp_total * fa.rate)
                 end > 0.01),
               false) as totals_differ
        from pairs pr
        left join fiscal f on f.id = pr.purchase_id
        cross join lateral (
          select case when pr.kind = 'nc' then -1 else 1 end as sign,
                 case when pr.moneda = 'PES' then 1
                      else coalesce(pr.cotizacion, f.cotizacion, 1) end as rate
        ) va
        left join lateral (
          select case when f.kind = 'nc' then -1 else 1 end as sign,
                 case when f.moneda = 'PES' then 1 else f.cotizacion end as rate
        ) fa on f.id is not null
      union all
      select null, f.id, null, f.fecha, false,
             null, null, null, null,
             fa.sign * f.imp_neto * fa.rate,
             fa.sign * f.imp_iva * fa.rate,
             fa.sign * f.imp_trib * fa.rate,
             fa.sign * f.imp_total * fa.rate,
             false
        from fiscal f
        cross join lateral (
          select case when f.kind = 'nc' then -1 else 1 end as sign,
                 case when f.moneda = 'PES' then 1 else f.cotizacion end as rate
        ) fa
       where not exists (select 1 from matched m where m.purchase_id = f.id)
    ) x;
$$;

revoke all on function public.purchase_arca_reconciliation_rows() from public, anon, authenticated;
grant execute on function public.purchase_arca_reconciliation_rows() to service_role;
