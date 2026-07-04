-- Audit remediation T3 — restore the supplier-opening-balance netting in
-- v_supplier_aging_documents.
--
-- 20260514221909 defined the supplier aging view subtracting
-- supplier_opening_balance_allocations. The NC-origin fix (20260516120000)
-- rebuilt the view and dropped that join; every later rebuild (due-date, moneda)
-- kept the regressed shape. The client twin (v_aging_documents) still nets its
-- opening allocations, so the two sides diverged. Effect: invoices settled via an
-- opening balance reappear as open payables in supplier aging and cash flow.
--
-- This recreates the current view (unchanged) plus the opening-allocations LEFT
-- JOIN, mirroring the client view.

set row_security = off;

create or replace view public.v_supplier_aging_documents with (security_invoker = on) as
  SELECT pi.id AS purchase_invoice_id,
    pi.supplier_id,
    pi.fecha,
    pi.kind,
    pi.letter,
    pi.punto_venta,
    pi.numero,
    pi.imp_total,
    COALESCE(alloc.applied, 0::numeric) + COALESCE(opening.applied, 0::numeric) AS amount_applied,
    COALESCE(nc.credited, 0::numeric) AS amount_credited_by_nc,
    pi.imp_total
      - COALESCE(alloc.applied, 0::numeric)
      - COALESCE(nc.credited, 0::numeric)
      - COALESCE(opening.applied, 0::numeric) AS open_amount,
    CURRENT_DATE - pi.fecha AS days_overdue,
        CASE
            WHEN (CURRENT_DATE - pi.fecha) <= 30 THEN '0_30'::text
            WHEN (CURRENT_DATE - pi.fecha) <= 60 THEN '30_60'::text
            WHEN (CURRENT_DATE - pi.fecha) <= 90 THEN '60_90'::text
            ELSE '90_plus'::text
        END AS bucket,
    pi.channel_id,
    ch.name AS channel_name,
    ch.is_fiscal AS channel_is_fiscal,
    pi.fch_vto_pago AS fch_vto_pago,
    pi.moneda AS moneda
   FROM purchase_invoices pi
     JOIN invoicing_channels ch ON ch.id = pi.channel_id
     LEFT JOIN ( SELECT poa.purchase_invoice_id,
            sum(poa.amount_applied) AS applied
           FROM payment_order_allocations poa
             JOIN payment_orders po ON po.id = poa.payment_order_id
          WHERE po.status = 'issued'::text
          GROUP BY poa.purchase_invoice_id) alloc ON alloc.purchase_invoice_id = pi.id
     LEFT JOIN ( SELECT nc_1.invoice_origin_id,
            sum(nc_1.imp_total) AS credited
           FROM purchase_invoices nc_1
          WHERE nc_1.kind = 'nc'::text AND nc_1.status = 'received'::text AND nc_1.invoice_origin_id IS NOT NULL
          GROUP BY nc_1.invoice_origin_id) nc ON nc.invoice_origin_id = pi.id
     LEFT JOIN ( SELECT soba.purchase_invoice_id,
            soba.amount_applied AS applied
           FROM supplier_opening_balance_allocations soba) opening ON opening.purchase_invoice_id = pi.id
  WHERE pi.status = 'received'::text
    AND (pi.kind = ANY (ARRAY['factura'::text, 'nd'::text]))
    AND (pi.imp_total
         - COALESCE(alloc.applied, 0::numeric)
         - COALESCE(nc.credited, 0::numeric)
         - COALESCE(opening.applied, 0::numeric)) > 0::numeric;

set row_security = on;
