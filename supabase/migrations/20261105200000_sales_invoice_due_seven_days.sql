SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A sales comprobante is due 7 days after its date unless it carries a later
-- due date (owner decision, docs/decisions/2026-11-05-vencimiento-de-ventas-a-7-dias.md).
-- Every ARCA import stores fch_vto_pago null or equal to fecha, so the
-- receivables read every open factura as overdue the day after it was issued
-- (a «Cobranza vencida» task, aging and late interest from day 1).
--
--   1. invoice_effective_due_date(fecha, fch_vto_pago): the rule, in one
--      place. fch_vto_pago when it is after fecha, else fecha + 7. The 7 is
--      SALES_INVOICE_DUE_DAYS in lib/receivables.ts (a Vitest reads it here).
--   2. v_aging_documents (same columns, due_date appended): days_overdue and
--      bucket count from the effective due date; due_date is that date (a
--      rejected check's is its rejection day, as before). fch_vto_pago stays
--      the stored AFIP value. Every reader follows: v_client_aging,
--      v_client_aging_by_scope, capture_aging_snapshot, the client statement,
--      the AI tools, and the readers below.
--   3. late_interest_candidates: due_date, charge_from and the overdue filter
--      read the view's due_date (same signature and columns).
--   4. ai_client_sales_summary: overdue_ars reads the view's due_date instead
--      of «fch_vto_pago, else fecha + 30».
--   sync_automatic_tasks follows in 20261105200001.
--
-- Stored fch_vto_pago values are not touched. Purchases keep their own rule.
--
-- Rollback: older code reads the same columns (the cash flow places
-- receivables by fch_vto_pago, else fecha, as before); due_date is ignored.

create function public.invoice_effective_due_date(p_fecha date, p_fch_vto_pago date)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when p_fch_vto_pago > p_fecha then p_fch_vto_pago
    else p_fecha + 7
  end
$$;

comment on function public.invoice_effective_due_date(date, date) is
  'Vencimiento de cobro de un comprobante de venta: fch_vto_pago si es posterior a la fecha, si no fecha + 7 días.';

revoke all on function public.invoice_effective_due_date(date, date) from public, anon;
-- v_aging_documents (security invoker) is read by the user's client.
grant execute on function public.invoice_effective_due_date(date, date) to authenticated, service_role;

create or replace view public.v_aging_documents with (security_invoker = on) as
  with docs as (
  SELECT c.id AS invoice_id,
    c.client_id,
    c.fecha,
    c.kind,
    c.letter,
    c.punto_venta,
    c.numero,
    c.imp_total,
    COALESCE(alloc.applied, 0::numeric) + COALESCE(opening.applied, 0::numeric) AS amount_applied,
    c.imp_total - COALESCE(alloc.applied, 0::numeric) - COALESCE(opening.applied, 0::numeric) - COALESCE(nc.credited, 0::numeric) AS open_amount,
    CURRENT_DATE - due.due_date AS days_overdue,
        CASE
            WHEN (CURRENT_DATE - due.due_date) <= 30 THEN '0_30'::text
            WHEN (CURRENT_DATE - due.due_date) <= 60 THEN '30_60'::text
            WHEN (CURRENT_DATE - due.due_date) <= 90 THEN '60_90'::text
            ELSE '90_plus'::text
        END AS bucket,
    c.channel_id,
    ch.name AS channel_name,
    ch.is_fiscal AS channel_is_fiscal,
    c.fch_vto_pago AS fch_vto_pago,
    c.moneda AS moneda,
    COALESCE(nc.credited, 0::numeric) AS amount_credited_by_nc,
    'invoice'::text AS document_type,
    c.id AS document_id,
    NULL::text AS check_number,
    due.due_date
   FROM invoices c
     JOIN invoicing_channels ch ON ch.id = c.channel_id
     CROSS JOIN LATERAL ( SELECT public.invoice_effective_due_date(c.fecha, c.fch_vto_pago) AS due_date) due
     LEFT JOIN ( SELECT ra.invoice_id,
            sum(ra.amount_applied) AS applied
           FROM receipt_allocations ra
             JOIN receipts r ON r.id = ra.receipt_id
          WHERE r.status = 'issued'::text
          GROUP BY ra.invoice_id) alloc ON alloc.invoice_id = c.id
     LEFT JOIN ( SELECT client_opening_balance_allocations.invoice_id,
            client_opening_balance_allocations.amount_applied AS applied
           FROM client_opening_balance_allocations) opening ON opening.invoice_id = c.id
     LEFT JOIN ( SELECT n.invoice_origin_id,
            sum(n.imp_total) AS credited
           FROM invoices n
          WHERE n.kind = 'nc'::text AND n.status = 'emitted'::text AND n.invoice_origin_id IS NOT NULL
          GROUP BY n.invoice_origin_id) nc ON nc.invoice_origin_id = c.id
  WHERE c.status = 'emitted'::text AND (c.kind = ANY (ARRAY['factura'::text, 'nd'::text])) AND (c.imp_total - COALESCE(alloc.applied, 0::numeric) - COALESCE(opening.applied, 0::numeric) - COALESCE(nc.credited, 0::numeric)) > 0::numeric
  UNION ALL
  SELECT NULL::uuid AS invoice_id,
    o.client_id,
    o.rejected_on AS fecha,
    'rejected_check'::text AS kind,
    NULL::character(1) AS letter,
    o.punto_venta,
    o.numero,
    o.amount::numeric(15,2) AS imp_total,
    o.amount_settled AS amount_applied,
    o.open_amount,
    CURRENT_DATE - o.rejected_on AS days_overdue,
        CASE
            WHEN (CURRENT_DATE - o.rejected_on) <= 30 THEN '0_30'::text
            WHEN (CURRENT_DATE - o.rejected_on) <= 60 THEN '30_60'::text
            WHEN (CURRENT_DATE - o.rejected_on) <= 90 THEN '60_90'::text
            ELSE '90_plus'::text
        END AS bucket,
    o.channel_id,
    ch.name AS channel_name,
    ch.is_fiscal AS channel_is_fiscal,
    o.rejected_on AS fch_vto_pago,
    CASE WHEN o.currency = 'USD' THEN 'DOL'::text ELSE 'PES'::text END AS moneda,
    0::numeric AS amount_credited_by_nc,
    'rejected_check'::text AS document_type,
    o.check_id AS document_id,
    o.check_number,
    o.rejected_on AS due_date
   FROM v_rejected_check_open o
     JOIN invoicing_channels ch ON ch.id = o.channel_id
  WHERE o.open_amount > 0::numeric
  ),
  unlinked AS (
  SELECT n.client_id,
    n.channel_id,
    CASE WHEN COALESCE(n.moneda, 'PES') IN ('DOL', 'USD') THEN 'USD'::text ELSE 'ARS'::text END AS currency,
    sum(n.imp_total) AS credit
   FROM invoices n
  WHERE n.kind = 'nc'::text AND n.status = 'emitted'::text AND n.invoice_origin_id IS NULL
  GROUP BY n.client_id, n.channel_id, (CASE WHEN COALESCE(n.moneda, 'PES') IN ('DOL', 'USD') THEN 'USD'::text ELSE 'ARS'::text END)
  ),
  spread AS (
  SELECT d.*,
    LEAST(d.open_amount, GREATEST(COALESCE(u.credit, 0::numeric) - COALESCE(sum(d.open_amount) OVER (
      PARTITION BY d.client_id, d.channel_id, (CASE WHEN COALESCE(d.moneda, 'PES') IN ('DOL', 'USD') THEN 'USD'::text ELSE 'ARS'::text END)
      ORDER BY d.days_overdue DESC, d.fecha, d.document_id
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0::numeric), 0::numeric)) AS credited_unlinked
   FROM docs d
     LEFT JOIN unlinked u ON u.client_id = d.client_id AND u.channel_id = d.channel_id
       AND u.currency = (CASE WHEN COALESCE(d.moneda, 'PES') IN ('DOL', 'USD') THEN 'USD'::text ELSE 'ARS'::text END)
  )
  SELECT s.invoice_id,
    s.client_id,
    s.fecha,
    s.kind,
    s.letter,
    s.punto_venta,
    s.numero,
    s.imp_total,
    s.amount_applied,
    s.open_amount - s.credited_unlinked AS open_amount,
    s.days_overdue,
    s.bucket,
    s.channel_id,
    s.channel_name,
    s.channel_is_fiscal,
    s.fch_vto_pago,
    s.moneda,
    s.amount_credited_by_nc,
    s.document_type,
    s.document_id,
    s.check_number,
    s.credited_unlinked AS amount_credited_unlinked,
    s.due_date
   FROM spread s
  WHERE s.open_amount - s.credited_unlinked > 0::numeric;

comment on view public.v_aging_documents is
  'Comprobantes (factura/ND) y cheques rechazados de clientes con saldo abierto. open_amount = imp_total − recibos − saldo inicial − NC con origen − la parte del crédito de las NC sin origen del cliente (mismo canal y moneda, de la más vencida a la más nueva) que tomó el documento (amount_credited_unlinked). due_date = invoice_effective_due_date (el rechazo para un cheque); days_overdue y bucket cuentan desde ahí.';

-- Same as 20261104080300 with the due date from v_aging_documents.due_date.
create or replace function public.late_interest_candidates(p_as_of date)
returns table (
  invoice_id      uuid,
  client_id       uuid,
  client_name     text,
  channel_id      text,
  channel_is_fiscal boolean,
  kind            text,
  letter          text,
  punto_venta     integer,
  numero          integer,
  fecha           date,
  due_date        date,
  moneda          text,
  open_amount     numeric,
  charged_to      date,
  charge_from     date,
  client_rate     numeric,
  monthly_rate    numeric,
  balance_days    numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.invoice_id,
         d.client_id,
         cl.legal_name,
         d.channel_id,
         d.channel_is_fiscal,
         d.kind,
         d.letter::text,
         d.punto_venta,
         d.numero,
         d.fecha,
         d.due_date,
         d.moneda,
         d.open_amount,
         lc.charged_to,
         cf.charge_from,
         cl.late_interest_monthly_rate,
         coalesce(cl.late_interest_monthly_rate,
                  (select (s.value #>> '{}')::numeric
                     from public.finance_settings s
                    where s.key = 'late_interest_monthly_rate')),
         greatest(p_as_of - cf.charge_from + 1, 0) * d.open_amount
           + public.late_interest_reductions_after(d.invoice_id, cf.charge_from, p_as_of)
    from public.v_aging_documents d
    join public.clients cl on cl.id = d.client_id
    left join lateral (
      select max(c.period_to) as charged_to
        from public.late_interest_charges c
       where c.invoice_id = d.invoice_id
         and public.late_interest_charge_is_live(c)
    ) lc on true
    cross join lateral (
      select greatest(d.due_date, coalesce(lc.charged_to, d.fecha)) + 1
               as charge_from
    ) cf
   where d.document_type = 'invoice'
     and d.open_amount > 0
     and d.due_date < p_as_of
     and not exists (select 1 from public.late_interest_charges x
                      where x.nd_invoice_id = d.invoice_id)
   order by cl.legal_name, d.due_date, d.invoice_id
$$;

revoke all on function public.late_interest_candidates(date) from public, anon, authenticated;
grant execute on function public.late_interest_candidates(date) to service_role;

-- Same as 20261031184339 with overdue_ars past the view's due_date.
create or replace function public.ai_client_sales_summary(
  p_from date,
  p_to date,
  p_client_id uuid default null,
  p_limit integer default 50,
  p_is_fiscal boolean default null
)
returns table(
  client_id uuid,
  legal_name text,
  invoiced_ars numeric,
  invoices integer,
  credit_notes integer,
  collected_ars numeric,
  collected_usd numeric,
  receipts integer,
  avg_days_to_pay numeric,
  open_ars numeric,
  open_foreign numeric,
  overdue_ars numeric,
  total_clients integer,
  total_invoiced_ars numeric,
  total_collected_ars numeric,
  total_open_ars numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with inv as (
    select
      i.client_id,
      sum(case when i.kind = 'nc' then -1 else 1 end * i.imp_total * coalesce(nullif(i.cotizacion, 0), 1)) as invoiced_ars,
      count(*) filter (where i.kind <> 'nc') as invoices,
      count(*) filter (where i.kind = 'nc') as credit_notes
    from public.invoices i
    where i.status = 'emitted'
      and i.fecha between p_from and p_to
      and (p_client_id is null or i.client_id = p_client_id)
      and (p_is_fiscal is null or exists (
        select 1 from public.invoicing_channels c
        where c.id = i.channel_id and c.is_fiscal = p_is_fiscal
      ))
    group by i.client_id
  ),
  rec as (
    select
      r.client_id,
      sum(r.total_amount) filter (where r.currency = 'ARS') as collected_ars,
      sum(r.total_amount) filter (where r.currency = 'USD') as collected_usd,
      count(*) as receipts
    from public.receipts r
    where r.status = 'issued'
      and r.receipt_date between p_from and p_to
      and (p_client_id is null or r.client_id = p_client_id)
      and (p_is_fiscal is null or exists (
        select 1 from public.invoicing_channels c
        where c.id = r.channel_id and c.is_fiscal = p_is_fiscal
      ))
    group by r.client_id
  ),
  dtp as (
    select
      r.client_id,
      sum((r.receipt_date - i.fecha) * ra.amount_applied) / nullif(sum(ra.amount_applied), 0) as avg_days
    from public.receipts r
    join public.receipt_allocations ra on ra.receipt_id = r.id
    join public.invoices i on i.id = ra.invoice_id
    where r.status = 'issued'
      and r.receipt_date between p_from and p_to
      and (p_client_id is null or r.client_id = p_client_id)
      and (p_is_fiscal is null or exists (
        select 1 from public.invoicing_channels c
        where c.id = r.channel_id and c.is_fiscal = p_is_fiscal
      ))
    group by r.client_id
  ),
  debt as (
    select
      d.client_id,
      sum(d.open_amount) filter (where d.moneda = 'PES') as open_ars,
      sum(d.open_amount) filter (where d.moneda <> 'PES') as open_foreign,
      sum(d.open_amount) filter (
        where d.moneda = 'PES' and d.due_date < current_date
      ) as overdue_ars
    from public.v_aging_documents d
    where (p_client_id is null or d.client_id = p_client_id)
      and (p_is_fiscal is null or d.channel_is_fiscal = p_is_fiscal)
    group by d.client_id
  ),
  keys as (
    select inv.client_id from inv
    union
    select rec.client_id from rec
    union
    select debt.client_id from debt
  )
  select
    k.client_id,
    c.legal_name,
    round(coalesce(inv.invoiced_ars, 0), 2),
    coalesce(inv.invoices, 0)::integer,
    coalesce(inv.credit_notes, 0)::integer,
    coalesce(rec.collected_ars, 0),
    coalesce(rec.collected_usd, 0),
    coalesce(rec.receipts, 0)::integer,
    round(dtp.avg_days, 1),
    coalesce(debt.open_ars, 0),
    coalesce(debt.open_foreign, 0),
    coalesce(debt.overdue_ars, 0),
    (count(*) over ())::integer,
    round(sum(coalesce(inv.invoiced_ars, 0)) over (), 2),
    sum(coalesce(rec.collected_ars, 0)) over (),
    sum(coalesce(debt.open_ars, 0)) over ()
  from keys k
  join public.clients c on c.id = k.client_id
  left join inv on inv.client_id = k.client_id
  left join rec on rec.client_id = k.client_id
  left join dtp on dtp.client_id = k.client_id
  left join debt on debt.client_id = k.client_id
  order by 3 desc, 10 desc, 2
  limit greatest(1, least(p_limit, 500));
$$;
