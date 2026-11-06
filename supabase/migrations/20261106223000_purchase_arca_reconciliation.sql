SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Conciliación con ARCA for purchases (Compras › Recibidos de ARCA ›
-- Conciliación). Each supplier numbers its own vouchers, so there are no gaps
-- to look for: the vouchers ARCA lists as received (arca_received_vouchers,
-- not discarded) are compared with the fiscal purchases (fiscal channel, not
-- cancelled), month by month and one by one.
--
--   purchase_arca_reconciliation_rows(): one row per ARCA voucher (with the
--     purchase it matches, if any) plus one per purchase no voucher matches.
--     A voucher matches the purchase it is linked to, else the one with its
--     supplier CUIT, kind, punto de venta and número (same letter first, else
--     a purchase loaded without letter), the rule link_received_vouchers uses.
--     Amounts in ARS (USD × cotización), an NC negative. A voucher whose
--     amounts did not read (unreadable_reason) or whose type the tray does
--     not load (no kind) is counted but not compared: its amounts are null.
--     A purchase two vouchers match carries its amounts on one row only.
--   purchase_arca_reconciliation_months(): the totals per month, each side
--     by its own fecha.
--   purchase_arca_reconciliation_detail(from, to, limit): the vouchers only
--     in ARCA, the purchases only in the ERP and the pairs whose total
--     differs by more than 0.01, up to p_limit of each with their count.
--
-- SECURITY INVOKER, executed only by the service role from an action gated by
-- purchase_invoices:write (the tray's gate). No data change. Rollback: older
-- code never calls these functions.

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
  with fiscal as (
    select p.id, s.cuit, p.kind, p.letter, p.punto_venta, p.numero, p.fecha,
           p.moneda, p.cotizacion, p.imp_neto, p.imp_iva, p.imp_trib, p.imp_total
      from public.purchase_invoices p
      join public.invoicing_channels c on c.id = p.channel_id and c.is_fiscal
      join public.suppliers s on s.id = p.supplier_id
     where p.status <> 'cancelled'
  ),
  matched as (
    select v.id, v.fecha, v.kind, v.moneda, v.cotizacion,
           v.imp_neto_gravado, v.imp_iva, v.imp_trib, v.imp_total,
           v.kind is not null and v.unreadable_reason is null as comparable,
           m.id as purchase_id
      from public.arca_received_vouchers v
      left join lateral (
        select f.id
          from fiscal f
         where f.id = v.purchase_invoice_id
            or (f.cuit = v.issuer_cuit and f.kind = v.kind
                and f.punto_venta = v.punto_venta and f.numero = v.numero
                and (f.letter = v.letter or f.letter is null))
         order by f.id = v.purchase_invoice_id desc nulls last,
                  f.letter = v.letter desc nulls last
         limit 1
      ) m on true
     where v.status <> 'discarded'
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

create or replace function public.purchase_arca_reconciliation_months()
returns table (
  month             date,
  arca_count        int,
  arca_uncomparable int,
  arca_neto         numeric,
  arca_iva          numeric,
  arca_trib         numeric,
  arca_total        numeric,
  erp_count         int,
  erp_neto          numeric,
  erp_iva           numeric,
  erp_trib          numeric,
  erp_total         numeric,
  arca_only         int,
  erp_only          int,
  amount_mismatch   int
)
language sql
stable
security invoker
set search_path = ''
as $$
  with r as (
    select * from public.purchase_arca_reconciliation_rows()
  ),
  a as (
    select date_trunc('month', r.arca_fecha)::date as month,
           count(*)::int as arca_count,
           (count(*) filter (where not r.arca_comparable))::int as arca_uncomparable,
           coalesce(sum(r.arca_neto), 0) as arca_neto,
           coalesce(sum(r.arca_iva), 0) as arca_iva,
           coalesce(sum(r.arca_trib), 0) as arca_trib,
           coalesce(sum(r.arca_total), 0) as arca_total,
           (count(*) filter (where r.purchase_invoice_id is null))::int as arca_only,
           (count(*) filter (where r.totals_differ))::int as amount_mismatch
      from r
     where r.voucher_id is not null
     group by 1
  ),
  e as (
    select date_trunc('month', r.erp_fecha)::date as month,
           count(*)::int as erp_count,
           coalesce(sum(r.erp_neto), 0) as erp_neto,
           coalesce(sum(r.erp_iva), 0) as erp_iva,
           coalesce(sum(r.erp_trib), 0) as erp_trib,
           coalesce(sum(r.erp_total), 0) as erp_total,
           (count(*) filter (where r.voucher_id is null))::int as erp_only
      from r
     where r.erp_fecha is not null
     group by 1
  )
  select coalesce(a.month, e.month),
         coalesce(a.arca_count, 0), coalesce(a.arca_uncomparable, 0),
         round(coalesce(a.arca_neto, 0), 2), round(coalesce(a.arca_iva, 0), 2),
         round(coalesce(a.arca_trib, 0), 2), round(coalesce(a.arca_total, 0), 2),
         coalesce(e.erp_count, 0),
         round(coalesce(e.erp_neto, 0), 2), round(coalesce(e.erp_iva, 0), 2),
         round(coalesce(e.erp_trib, 0), 2), round(coalesce(e.erp_total, 0), 2),
         coalesce(a.arca_only, 0), coalesce(e.erp_only, 0),
         coalesce(a.amount_mismatch, 0)
    from a
    full join e on e.month = a.month
   order by 1;
$$;

revoke all on function public.purchase_arca_reconciliation_months() from public, anon, authenticated;
grant execute on function public.purchase_arca_reconciliation_months() to service_role;

create or replace function public.purchase_arca_reconciliation_detail(
  p_from  date,
  p_to    date,
  p_limit int
)
returns table (
  issue               text,
  issue_count         int,
  voucher_id          uuid,
  voucher_status      text,
  purchase_invoice_id uuid,
  fecha               date,
  issuer_cuit         text,
  issuer_name         text,
  cbte_tipo           bigint,
  kind                text,
  letter              text,
  punto_venta         bigint,
  numero              bigint,
  arca_moneda         text,
  arca_total          numeric,
  erp_moneda          text,
  erp_total           numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with r as (
    select * from public.purchase_arca_reconciliation_rows()
  ),
  issues as (
    select 'arca_only' as issue, r.voucher_id, r.purchase_invoice_id
      from r
     where r.voucher_id is not null and r.purchase_invoice_id is null
       and r.arca_fecha between p_from and p_to
    union all
    select 'erp_only', r.voucher_id, r.purchase_invoice_id
      from r
     where r.voucher_id is null
       and r.erp_fecha between p_from and p_to
    union all
    select 'amount_mismatch', r.voucher_id, r.purchase_invoice_id
      from r
     where r.totals_differ
       and r.arca_fecha between p_from and p_to
  ),
  shown as (
    select i.issue,
           count(*) over (partition by i.issue) as issue_count,
           v.id as voucher_id, v.status as voucher_status,
           p.id as purchase_invoice_id,
           coalesce(v.fecha, p.fecha) as fecha,
           coalesce(v.issuer_cuit, sp.cuit) as issuer_cuit,
           coalesce(sp.display_name, sp.legal_name,
                    sv.display_name, sv.legal_name, v.issuer_name) as issuer_name,
           v.cbte_tipo,
           coalesce(v.kind, p.kind) as kind,
           coalesce(v.letter, p.letter) as letter,
           coalesce(v.punto_venta, p.punto_venta::bigint) as punto_venta,
           coalesce(v.numero, p.numero::bigint) as numero,
           v.moneda as arca_moneda, v.imp_total as arca_total,
           p.moneda as erp_moneda, p.imp_total as erp_total,
           row_number() over (
             partition by i.issue
             order by coalesce(v.fecha, p.fecha) desc,
                      coalesce(v.numero, p.numero::bigint) desc
           ) as rn
      from issues i
      left join public.arca_received_vouchers v on v.id = i.voucher_id
      left join public.purchase_invoices p on p.id = i.purchase_invoice_id
      left join public.suppliers sp on sp.id = p.supplier_id
      left join public.suppliers sv on sv.cuit = v.issuer_cuit
  )
  select s.issue, s.issue_count::int, s.voucher_id, s.voucher_status,
         s.purchase_invoice_id, s.fecha, s.issuer_cuit, s.issuer_name,
         s.cbte_tipo, s.kind, s.letter, s.punto_venta, s.numero,
         s.arca_moneda, s.arca_total, s.erp_moneda, s.erp_total
    from shown s
   where s.rn <= greatest(p_limit, 0)
   order by s.issue, s.rn;
$$;

revoke all on function public.purchase_arca_reconciliation_detail(date, date, int) from public, anon, authenticated;
grant execute on function public.purchase_arca_reconciliation_detail(date, date, int) to service_role;
