SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Aging counted overdue days from the invoice date even when the invoice
-- carries its payment due date (fch_vto_pago): an invoice at 60 days was
-- shown 60 days late on its due date. Days and bucket now run from
-- fch_vto_pago, falling back to fecha when it is null; a document not yet
-- due has negative days and stays in 0_30. Same columns, same order, so
-- v_client_aging and v_client_aging_by_scope keep reading it unchanged.

create or replace view public.v_aging_documents with (security_invoker = on) as
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
    COALESCE(nc.credited, 0::numeric) AS amount_credited_by_nc
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
  WHERE c.status = 'emitted'::text AND (c.kind = ANY (ARRAY['factura'::text, 'nd'::text])) AND (c.imp_total - COALESCE(alloc.applied, 0::numeric) - COALESCE(opening.applied, 0::numeric) - COALESCE(nc.credited, 0::numeric)) > 0::numeric;
