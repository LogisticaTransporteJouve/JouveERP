SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Client aging nets the credit notes that have no origin (audit w1-s2 F4,
-- w1-s1 F7). An NC imported from ARCA with no CbtesAsoc (origin_unlinked,
-- invoice_origin_id NULL) lowers the client's statement
-- (v_client_account_movements) but no comprobante, so the aging, its
-- snapshots, the scoped balance, the late interest and the collection tasks
-- stayed above the statement by that NC.
--
--   1. v_aging_documents (same columns, one appended): the emitted NCs with no
--      origin of a client, per channel and currency, are a credit spread over
--      that client's open documents of the same channel and currency from the
--      oldest due date forward (the order of the buckets, as
--      aging_apply_credit does for suppliers). open_amount is what is left; a
--      document the credit covers whole leaves the view. The appended
--      amount_credited_unlinked says how much of the credit each document
--      took. Credit the documents can't absorb is not shown (the aging never
--      goes below 0; the statement still shows it).
--      Every reader of the view follows with no change of its own:
--      v_client_aging, v_client_aging_by_scope, capture_aging_snapshot,
--      late_interest_candidates, sync_automatic_tasks,
--      ai_client_sales_summary, the client statement, the cash flow and the
--      AI tools.
--   2. invoice_open_amount: granted to service_role. The NC cap of
--      issueFiscalInvoiceAction reads it instead of the view: an NC against
--      an origin is capped by what that comprobante itself owes (the deferred
--      guard's own figure), not by the client's floating credit.
--
-- The window runs per client, channel and currency, so a filter on client_id
-- still reaches the base tables.
--
-- Rollback: older code reads the same columns; the NC cap of older code reads
-- open_amount, which can now be lower than what the guard allows (it refuses
-- an NC the database would accept, never the other way around).

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
    CURRENT_DATE - COALESCE(c.fch_vto_pago, c.fecha) AS days_overdue,
        CASE
            WHEN (CURRENT_DATE - COALESCE(c.fch_vto_pago, c.fecha)) <= 30 THEN '0_30'::text
            WHEN (CURRENT_DATE - COALESCE(c.fch_vto_pago, c.fecha)) <= 60 THEN '30_60'::text
            WHEN (CURRENT_DATE - COALESCE(c.fch_vto_pago, c.fecha)) <= 90 THEN '60_90'::text
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
    NULL::text AS check_number
   FROM invoices c
     JOIN invoicing_channels ch ON ch.id = c.channel_id
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
    o.check_number
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
    s.credited_unlinked AS amount_credited_unlinked
   FROM spread s
  WHERE s.open_amount - s.credited_unlinked > 0::numeric;

comment on view public.v_aging_documents is
  'Comprobantes (factura/ND) y cheques rechazados de clientes con saldo abierto. open_amount = imp_total − recibos − saldo inicial − NC con origen − la parte del crédito de las NC sin origen del cliente (mismo canal y moneda, de la más vencida a la más nueva) que tomó el documento (amount_credited_unlinked).';

grant execute on function public.invoice_open_amount(uuid) to service_role;
