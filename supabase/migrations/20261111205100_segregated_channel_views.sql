SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- The read models say whether a row belongs to a segregated channel
-- (20261111205000), so the main app can leave it out and its section can
-- read it alone.
--
-- 1. v_aging_documents, v_supplier_aging_documents, v_client_account_movements,
--    v_supplier_account_movements, v_receipt_unapplied and
--    v_payment_order_unapplied append channel_is_segregated as their last
--    column (NULL on the opening-balance rows, which have no channel).
--    Bodies copied from their latest definitions; nothing else changes.
-- 2. v_supplier_aging_by_channel holds the bucket expressions once, per
--    supplier and channel. v_supplier_aging and v_supplier_aging_by_scope
--    become sums over it without the segregated channels (same columns).
--    v_client_aging(_by_scope) leave them out too.
-- 3. party_in_main_scope(kind, id): false for a supplier or client that only
--    has documents on segregated channels (or, a supplier with no main
--    document, whose default channel is segregated). Exposed to PostgREST as
--    the computed field in_main_scope of suppliers and clients.
--
-- With no segregated channel holding documents, every view returns the same
-- rows as before. Rollback: older code ignores the appended columns.

-- 1. Base views ---------------------------------------------------------------------

-- 20261106222124
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
    due.due_date,
    ch.is_segregated AS channel_is_segregated
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
    o.rejected_on AS due_date,
    ch.is_segregated AS channel_is_segregated
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
    -- An NC up to a client's opening date is inside its opening balance: in
    -- pesos always, in dollars when the opening has a dollar target.
    AND NOT EXISTS (
      SELECT 1 FROM client_opening_balances ob
       WHERE ob.client_id = n.client_id AND n.fecha <= ob.opening_date
         AND (COALESCE(n.moneda, 'PES') NOT IN ('DOL', 'USD') OR ob.target_balance_usd IS NOT NULL))
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
    s.due_date,
    s.channel_is_segregated
   FROM spread s
  WHERE s.open_amount - s.credited_unlinked > 0::numeric;

-- 20261104101400
create or replace view public.v_supplier_aging_documents with (security_invoker = on) as
  with docs as (
  select
    pi.id as purchase_invoice_id,
    pi.supplier_id,
    pi.fecha,
    pi.kind,
    pi.letter,
    pi.punto_venta,
    pi.numero,
    pi.imp_total,
    o.amount_paid + o.amount_opening_applied as amount_applied,
    o.amount_credited_by_nc,
    o.open_amount,
    current_date - coalesce(pi.fch_vto_pago, pi.fecha) as days_overdue,
    case
      when (current_date - coalesce(pi.fch_vto_pago, pi.fecha)) <= 30 then '0_30'
      when (current_date - coalesce(pi.fch_vto_pago, pi.fecha)) <= 60 then '30_60'
      when (current_date - coalesce(pi.fch_vto_pago, pi.fecha)) <= 90 then '60_90'
      else '90_plus'
    end as bucket,
    pi.channel_id,
    ch.name as channel_name,
    ch.is_fiscal as channel_is_fiscal,
    pi.fch_vto_pago,
    pi.moneda,
    'purchase_invoice'::text as document_type,
    pi.id as document_id,
    null::text as check_number,
    ch.is_segregated as channel_is_segregated
  from public.purchase_invoices pi
  join public.v_purchase_invoice_open o on o.purchase_invoice_id = pi.id
  join public.invoicing_channels ch on ch.id = pi.channel_id
  where pi.status = 'received'
    and pi.kind in ('factura', 'nd')
    and o.open_amount > 0
  union all
  select
    null::uuid as purchase_invoice_id,
    r.supplier_id,
    r.rejected_on as fecha,
    'rejected_check'::text as kind,
    null::character(1) as letter,
    r.punto_venta,
    r.numero,
    r.amount::numeric(15,2) as imp_total,
    r.amount_settled as amount_applied,
    0::numeric as amount_credited_by_nc,
    r.open_amount,
    current_date - r.rejected_on as days_overdue,
    case
      when (current_date - r.rejected_on) <= 30 then '0_30'
      when (current_date - r.rejected_on) <= 60 then '30_60'
      when (current_date - r.rejected_on) <= 90 then '60_90'
      else '90_plus'
    end as bucket,
    r.channel_id,
    ch.name as channel_name,
    ch.is_fiscal as channel_is_fiscal,
    r.rejected_on as fch_vto_pago,
    case when r.currency = 'USD' then 'DOL'::text else 'PES'::text end as moneda,
    'rejected_check'::text as document_type,
    r.check_id as document_id,
    r.check_number,
    ch.is_segregated as channel_is_segregated
  from public.v_supplier_rejected_check_open r
  join public.invoicing_channels ch on ch.id = r.channel_id
  where r.open_amount > 0
  ),
  unlinked as (
  select n.supplier_id,
    n.channel_id,
    case when coalesce(n.moneda, 'PES') in ('DOL', 'USD') then 'USD'::text else 'ARS'::text end as currency,
    sum(n.imp_total) as credit
  from public.purchase_invoices n
  where n.kind = 'nc' and n.status = 'received' and n.invoice_origin_id is null
  group by n.supplier_id, n.channel_id, (case when coalesce(n.moneda, 'PES') in ('DOL', 'USD') then 'USD'::text else 'ARS'::text end)
  ),
  spread as (
  select d.*,
    least(d.open_amount, greatest(coalesce(u.credit, 0::numeric) - coalesce(sum(d.open_amount) over (
      partition by d.supplier_id, d.channel_id, (case when coalesce(d.moneda, 'PES') in ('DOL', 'USD') then 'USD'::text else 'ARS'::text end)
      order by d.days_overdue desc, d.fecha, d.document_id
      rows between unbounded preceding and 1 preceding), 0::numeric), 0::numeric)) as credited_unlinked
  from docs d
  left join unlinked u on u.supplier_id = d.supplier_id and u.channel_id = d.channel_id
    and u.currency = (case when coalesce(d.moneda, 'PES') in ('DOL', 'USD') then 'USD'::text else 'ARS'::text end)
  )
  select s.purchase_invoice_id,
    s.supplier_id,
    s.fecha,
    s.kind,
    s.letter,
    s.punto_venta,
    s.numero,
    s.imp_total,
    s.amount_applied,
    s.amount_credited_by_nc,
    s.open_amount - s.credited_unlinked as open_amount,
    s.days_overdue,
    s.bucket,
    s.channel_id,
    s.channel_name,
    s.channel_is_fiscal,
    s.fch_vto_pago,
    s.moneda,
    s.document_type,
    s.document_id,
    s.check_number,
    s.credited_unlinked as amount_credited_unlinked,
    s.channel_is_segregated
  from spread s
  where s.open_amount - s.credited_unlinked > 0::numeric;

-- 20261106222124
create or replace view public.v_client_account_movements with (security_invoker = on) as
  select
    'invoice'::text                      as source_type,
    c.id                                 as source_id,
    c.client_id,
    c.fecha                              as movement_date,
    c.created_at,
    c.kind,
    c.letter,
    c.punto_venta,
    c.numero,
    case when c.kind = 'nc' then -1::numeric * c.imp_total else c.imp_total end as signed_amount,
    c.imp_total                          as gross_amount,
    c.channel_id,
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    c.status,
    case when coalesce(c.moneda, 'PES') in ('DOL', 'USD') then 'USD' else 'ARS' end as currency,
    ch.is_segregated as channel_is_segregated
  from public.invoices c
  join public.invoicing_channels ch on ch.id = c.channel_id
  where c.status = 'emitted'
  union all
  select
    'receipt'::text                      as source_type,
    r.id                                 as source_id,
    r.client_id,
    r.receipt_date                       as movement_date,
    r.created_at,
    'receipt'::text                      as kind,
    null::text                           as letter,
    r.punto_venta,
    r.numero,
    -1::numeric * r.total_amount         as signed_amount,
    r.total_amount                       as gross_amount,
    r.channel_id,
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    r.status,
    r.currency,
    ch.is_segregated as channel_is_segregated
  from public.receipts r
  join public.invoicing_channels ch on ch.id = r.channel_id
  where r.status = 'issued'
  union all
  -- The opening balance: one row per currency it fixes (pesos always,
  -- dollars when it has a dollar target).
  select
    'opening_balance'::text              as source_type,
    null::uuid                           as source_id,
    ob.client_id,
    ob.opening_date                      as movement_date,
    ob.created_at,
    'opening_balance'::text              as kind,
    null::text                           as letter,
    null::integer                        as punto_venta,
    null::integer                        as numero,
    t.target                             as signed_amount,
    t.target                             as gross_amount,
    null::text                           as channel_id,
    null::boolean                        as channel_is_fiscal,
    null::text                           as channel_name,
    'issued'::text                       as status,
    t.currency                           as currency,
    null::boolean as channel_is_segregated
  from public.client_opening_balances ob
  cross join lateral (values
    ('ARS'::text, ob.target_balance),
    ('USD'::text, ob.target_balance_usd)
  ) t (currency, target)
  where t.target is not null
  union all
  -- A check of an issued receipt that bounced: the client owes it again. The
  -- receipt's allocations stay (the invoice reads paid); this row puts the
  -- debt back in the running balance. A receipt that settles it credits the
  -- balance like any receipt.
  select
    'rejected_check'::text               as source_type,
    k.id                                 as source_id,
    r.client_id,
    coalesce(rej.event_date, k.updated_at::date) as movement_date,
    coalesce(rej.created_at, k.updated_at)       as created_at,
    'rejected_check'::text               as kind,
    null::text                           as letter,
    r.punto_venta,
    r.numero,
    k.amount                             as signed_amount,
    k.amount                             as gross_amount,
    r.channel_id,
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    k.status,
    k.currency,
    ch.is_segregated as channel_is_segregated
  from public.checks k
  join public.receipts r on r.id = k.source_receipt_id
  join public.invoicing_channels ch on ch.id = r.channel_id
  left join lateral (
    select m.event_date, m.created_at
      from public.check_movements m
     where m.check_id = k.id and m.event = 'rejected'
     order by m.created_at desc, m.id desc
     limit 1
  ) rej on true
  where k.status = 'rechazado'
    and r.status = 'issued'
  union all
  -- A check the client handed over without a receipt (loaded by hand): a
  -- payment on account once it is in the cartera (it has a channel).
  select
    'manual_check'::text                 as source_type,
    k.id                                 as source_id,
    k.source_client_id                   as client_id,
    k.issue_date                         as movement_date,
    k.created_at,
    'manual_check'::text                 as kind,
    null::text                           as letter,
    null::integer                        as punto_venta,
    null::integer                        as numero,
    -1::numeric * k.amount               as signed_amount,
    k.amount                             as gross_amount,
    k.channel_id,
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    k.status,
    k.currency,
    ch.is_segregated as channel_is_segregated
  from public.checks k
  join public.invoicing_channels ch on ch.id = k.channel_id
  where k.source_kind = 'manual'
    and k.source_client_id is not null
  union all
  -- That check bounced: the client owes it again.
  select
    'rejected_check'::text               as source_type,
    k.id                                 as source_id,
    k.source_client_id                   as client_id,
    coalesce(rej.event_date, k.updated_at::date) as movement_date,
    coalesce(rej.created_at, k.updated_at)       as created_at,
    'rejected_check'::text               as kind,
    null::text                           as letter,
    null::integer                        as punto_venta,
    null::integer                        as numero,
    k.amount                             as signed_amount,
    k.amount                             as gross_amount,
    k.channel_id,
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    k.status,
    k.currency,
    ch.is_segregated as channel_is_segregated
  from public.checks k
  join public.invoicing_channels ch on ch.id = k.channel_id
  left join lateral (
    select m.event_date, m.created_at
      from public.check_movements m
     where m.check_id = k.id and m.event = 'rejected'
     order by m.created_at desc, m.id desc
     limit 1
  ) rej on true
  where k.source_kind = 'manual'
    and k.source_client_id is not null
    and k.status = 'rechazado';

create or replace view public.v_supplier_account_movements with (security_invoker = on) as
  select
    'purchase_invoice'::text as source_type,
    pi.id as source_id,
    pi.supplier_id,
    pi.fecha as movement_date,
    pi.created_at,
    pi.kind,
    pi.letter,
    pi.punto_venta,
    pi.numero,
    case when pi.kind = 'nc' then -1::numeric * pi.imp_total else pi.imp_total end as signed_amount,
    pi.imp_total as gross_amount,
    pi.channel_id,
    ch.is_fiscal as channel_is_fiscal,
    ch.name as channel_name,
    pi.status,
    case when coalesce(pi.moneda, 'PES') in ('DOL', 'USD') then 'USD' else 'ARS' end as currency,
    ch.is_segregated as channel_is_segregated
  from public.purchase_invoices pi
  join public.invoicing_channels ch on ch.id = pi.channel_id
  where pi.status = 'received'
  union all
  select
    'payment_order'::text as source_type,
    po.id as source_id,
    po.supplier_id,
    po.payment_date as movement_date,
    po.created_at,
    'payment_order'::text as kind,
    null::text as letter,
    po.punto_venta,
    po.numero,
    -1::numeric * po.total_amount as signed_amount,
    po.total_amount as gross_amount,
    po.channel_id,
    ch.is_fiscal as channel_is_fiscal,
    ch.name as channel_name,
    po.status,
    po.currency,
    ch.is_segregated as channel_is_segregated
  from public.payment_orders po
  join public.invoicing_channels ch on ch.id = po.channel_id
  where po.status = 'issued'
  union all
  -- The opening balance: one row per currency it fixes (pesos always,
  -- dollars when it has a dollar target).
  select
    'opening_balance'::text as source_type,
    null::uuid as source_id,
    ob.supplier_id,
    ob.opening_date as movement_date,
    ob.created_at,
    'opening_balance'::text as kind,
    null::text as letter,
    null::integer as punto_venta,
    null::integer as numero,
    t.target as signed_amount,
    t.target as gross_amount,
    null::text as channel_id,
    null::boolean as channel_is_fiscal,
    null::text as channel_name,
    'issued'::text as status,
    t.currency as currency,
    null::boolean as channel_is_segregated
  from public.supplier_opening_balances ob
  cross join lateral (values
    ('ARS'::text, ob.target_balance),
    ('USD'::text, ob.target_balance_usd)
  ) t (currency, target)
  where t.target is not null
  union all
  -- A check delivered by an issued order that bounced: we owe it again.
  -- Numbered with the order that delivered it.
  select
    'rejected_check'::text as source_type,
    o.check_id as source_id,
    o.supplier_id,
    o.rejected_on as movement_date,
    o.rejected_recorded_at as created_at,
    'rejected_check'::text as kind,
    null::text as letter,
    o.punto_venta,
    o.numero,
    o.amount as signed_amount,
    o.amount as gross_amount,
    o.channel_id,
    ch.is_fiscal as channel_is_fiscal,
    ch.name as channel_name,
    'issued'::text as status,
    o.currency,
    ch.is_segregated as channel_is_segregated
  from public.v_supplier_rejected_check_open o
  join public.invoicing_channels ch on ch.id = o.channel_id;

-- 20261103040200
create or replace view public.v_receipt_unapplied with (security_invoker = on) as
  select r.id as receipt_id,
         r.client_id,
         r.channel_id,
         c.is_fiscal as channel_is_fiscal,
         r.currency,
         r.receipt_date,
         r.total_amount
           - coalesce((select sum(ra.amount_applied) from public.receipt_allocations ra
                        where ra.receipt_id = r.id), 0)
           - coalesce((select sum(rc.amount_applied) from public.receipt_rejected_check_allocations rc
                        where rc.receipt_id = r.id), 0) as unapplied_amount,
         c.is_segregated as channel_is_segregated
    from public.receipts r
    join public.invoicing_channels c on c.id = r.channel_id
   where r.status = 'issued'
     and r.total_amount
           - coalesce((select sum(ra.amount_applied) from public.receipt_allocations ra
                        where ra.receipt_id = r.id), 0)
           - coalesce((select sum(rc.amount_applied) from public.receipt_rejected_check_allocations rc
                        where rc.receipt_id = r.id), 0) > 0.005;

-- 20261104101400
create or replace view public.v_payment_order_unapplied with (security_invoker = on) as
  select po.id as payment_order_id,
         po.supplier_id,
         po.channel_id,
         c.is_fiscal as channel_is_fiscal,
         po.currency,
         po.payment_date,
         po.total_amount
           - coalesce((select sum(pa.amount_applied) from public.payment_order_allocations pa
                        where pa.payment_order_id = po.id), 0)
           - coalesce((select sum(rc.amount_applied) from public.payment_order_rejected_check_allocations rc
                        where rc.payment_order_id = po.id), 0) as unapplied_amount,
         c.is_segregated as channel_is_segregated
    from public.payment_orders po
    join public.invoicing_channels c on c.id = po.channel_id
   where po.status = 'issued'
     and po.total_amount
           - coalesce((select sum(pa.amount_applied) from public.payment_order_allocations pa
                        where pa.payment_order_id = po.id), 0)
           - coalesce((select sum(rc.amount_applied) from public.payment_order_rejected_check_allocations rc
                        where rc.payment_order_id = po.id), 0) > 0.005;

------------------------------------------------------------------------------
-- 2. Supplier aging: the buckets once, per channel
------------------------------------------------------------------------------

create view public.v_supplier_aging_by_channel with (security_invoker = on) as
  select
    d.supplier_id as supplier_id,
    d.channel_id as channel_id,
    d.channel_is_fiscal as channel_is_fiscal,
    d.channel_is_segregated as channel_is_segregated,
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
  group by d.supplier_id, d.channel_id, d.channel_is_fiscal, d.channel_is_segregated;

comment on view public.v_supplier_aging_by_channel is
  'Aging de proveedores por canal (incluye los canales segregados). v_supplier_aging y v_supplier_aging_by_scope suman sus filas sin los segregados.';

revoke all on table public.v_supplier_aging_by_channel from public, anon;
grant select on table public.v_supplier_aging_by_channel to authenticated;
grant all on table public.v_supplier_aging_by_channel to service_role;

-- Same columns, order and types as 20261104101400.
create or replace view public.v_supplier_aging with (security_invoker = on) as
  select
    a.supplier_id as supplier_id,
    coalesce(sum(a.ars_bucket_0_30), 0) as ars_bucket_0_30,
    coalesce(sum(a.ars_bucket_30_60), 0) as ars_bucket_30_60,
    coalesce(sum(a.ars_bucket_60_90), 0) as ars_bucket_60_90,
    coalesce(sum(a.ars_bucket_90_plus), 0) as ars_bucket_90_plus,
    coalesce(sum(a.ars_total_open), 0) as ars_total_open,
    coalesce(sum(a.usd_bucket_0_30), 0) as usd_bucket_0_30,
    coalesce(sum(a.usd_bucket_30_60), 0) as usd_bucket_30_60,
    coalesce(sum(a.usd_bucket_60_90), 0) as usd_bucket_60_90,
    coalesce(sum(a.usd_bucket_90_plus), 0) as usd_bucket_90_plus,
    coalesce(sum(a.usd_total_open), 0) as usd_total_open,
    sum(a.document_count)::bigint as document_count,
    max(a.oldest_days) as oldest_days
  from public.v_supplier_aging_by_channel a
  where not a.channel_is_segregated
  group by a.supplier_id;

create or replace view public.v_supplier_aging_by_scope with (security_invoker = on) as
  select
    a.supplier_id as supplier_id,
    a.channel_is_fiscal as channel_is_fiscal,
    coalesce(sum(a.ars_bucket_0_30), 0) as ars_bucket_0_30,
    coalesce(sum(a.ars_bucket_30_60), 0) as ars_bucket_30_60,
    coalesce(sum(a.ars_bucket_60_90), 0) as ars_bucket_60_90,
    coalesce(sum(a.ars_bucket_90_plus), 0) as ars_bucket_90_plus,
    coalesce(sum(a.ars_total_open), 0) as ars_total_open,
    coalesce(sum(a.usd_bucket_0_30), 0) as usd_bucket_0_30,
    coalesce(sum(a.usd_bucket_30_60), 0) as usd_bucket_30_60,
    coalesce(sum(a.usd_bucket_60_90), 0) as usd_bucket_60_90,
    coalesce(sum(a.usd_bucket_90_plus), 0) as usd_bucket_90_plus,
    coalesce(sum(a.usd_total_open), 0) as usd_total_open,
    sum(a.document_count)::bigint as document_count,
    max(a.oldest_days) as oldest_days
  from public.v_supplier_aging_by_channel a
  where not a.channel_is_segregated
  group by a.supplier_id, a.channel_is_fiscal;

-- The embed suppliers!inner, as for the other two (20261104101400).
create function public.suppliers(public.v_supplier_aging_by_channel)
returns setof public.suppliers
rows 1
language sql
stable
set search_path = ''
as $$
  select s.* from public.suppliers s where s.id = $1.supplier_id
$$;

revoke all on function public.suppliers(public.v_supplier_aging_by_channel) from public, anon;
grant execute on function public.suppliers(public.v_supplier_aging_by_channel) to authenticated, service_role;

-- Client aging (20261031205518) without the segregated channels.
create or replace view public.v_client_aging with (security_invoker = on) as
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
    max(d.days_overdue) as oldest_days,
    coalesce(sum(d.open_amount) filter (where d.document_type = 'rejected_check' and coalesce(d.moneda, 'PES') not in ('DOL', 'USD')), 0) as ars_rejected_checks_open,
    coalesce(sum(d.open_amount) filter (where d.document_type = 'rejected_check' and coalesce(d.moneda, 'PES') in ('DOL', 'USD')), 0) as usd_rejected_checks_open
  from public.v_aging_documents d
  where not coalesce(d.channel_is_segregated, false)
  group by d.client_id;

create or replace view public.v_client_aging_by_scope with (security_invoker = on) as
  select
    d.client_id as client_id,
    d.channel_is_fiscal as channel_is_fiscal,
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
    max(d.days_overdue) as oldest_days,
    coalesce(sum(d.open_amount) filter (where d.document_type = 'rejected_check' and coalesce(d.moneda, 'PES') not in ('DOL', 'USD')), 0) as ars_rejected_checks_open,
    coalesce(sum(d.open_amount) filter (where d.document_type = 'rejected_check' and coalesce(d.moneda, 'PES') in ('DOL', 'USD')), 0) as usd_rejected_checks_open
  from public.v_aging_documents d
  where not coalesce(d.channel_is_segregated, false)
  group by d.client_id, d.channel_is_fiscal;

------------------------------------------------------------------------------
-- 3. Parties of the main app
------------------------------------------------------------------------------

-- Security definer: exports and searches evaluate it for any user who reads
-- suppliers or clients, and a role whose RLS hides invoices or purchases
-- must get the same answer. It only returns a boolean about a party.
create function public.party_in_main_scope(p_kind text, p_party_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'supplier' then not (
      (exists (select 1 from public.purchase_invoices pi
                 join public.invoicing_channels c on c.id = pi.channel_id
                where pi.supplier_id = p_party_id and c.is_segregated)
       or exists (select 1 from public.payment_orders po
                    join public.invoicing_channels c on c.id = po.channel_id
                   where po.supplier_id = p_party_id and c.is_segregated)
       or exists (select 1 from public.suppliers s
                    join public.invoicing_channels c on c.id = s.default_channel_id
                   where s.id = p_party_id and c.is_segregated))
      and not exists (select 1 from public.purchase_invoices pi
                        join public.invoicing_channels c on c.id = pi.channel_id
                       where pi.supplier_id = p_party_id and not c.is_segregated)
      and not exists (select 1 from public.payment_orders po
                        join public.invoicing_channels c on c.id = po.channel_id
                       where po.supplier_id = p_party_id and not c.is_segregated))
    when 'client' then not (
      (exists (select 1 from public.invoices i
                 join public.invoicing_channels c on c.id = i.channel_id
                where i.client_id = p_party_id and c.is_segregated)
       or exists (select 1 from public.receipts r
                    join public.invoicing_channels c on c.id = r.channel_id
                   where r.client_id = p_party_id and c.is_segregated))
      and not exists (select 1 from public.invoices i
                        join public.invoicing_channels c on c.id = i.channel_id
                       where i.client_id = p_party_id and not c.is_segregated)
      and not exists (select 1 from public.receipts r
                        join public.invoicing_channels c on c.id = r.channel_id
                       where r.client_id = p_party_id and not c.is_segregated))
    else true
  end;
$$;

comment on function public.party_in_main_scope(text, uuid) is
  'Si un proveedor (p_kind supplier) o cliente (client) pertenece a la app principal: falso si solo tiene documentos en canales segregados, o (proveedor sin documentos principales) si su canal por defecto es segregado.';

revoke all on function public.party_in_main_scope(text, uuid) from public, anon, authenticated;
grant execute on function public.party_in_main_scope(text, uuid) to authenticated, service_role;

create function public.in_main_scope(public.suppliers)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.party_in_main_scope('supplier', $1.id)
$$;

create function public.in_main_scope(public.clients)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.party_in_main_scope('client', $1.id)
$$;

revoke all on function public.in_main_scope(public.suppliers) from public, anon;
revoke all on function public.in_main_scope(public.clients) from public, anon;
grant execute on function public.in_main_scope(public.suppliers) to authenticated, service_role;
grant execute on function public.in_main_scope(public.clients) to authenticated, service_role;
