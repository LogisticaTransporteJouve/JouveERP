-- Expone fch_vto_pago (fecha de vencimiento de pago) en las vistas de aging por
-- documento, para que el flujo de caja proyecte cada factura abierta en el mes
-- de su vencimiento real (en vez de amontonar todo en el primer mes). Solo
-- agrega una columna al final — las vistas dependientes (v_client_aging,
-- v_supplier_aging) no se ven afectadas.

set row_security = off;

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
    c.imp_total - COALESCE(alloc.applied, 0::numeric) - COALESCE(opening.applied, 0::numeric) AS open_amount,
    CURRENT_DATE - c.fecha AS days_overdue,
        CASE
            WHEN (CURRENT_DATE - c.fecha) <= 30 THEN '0_30'::text
            WHEN (CURRENT_DATE - c.fecha) <= 60 THEN '30_60'::text
            WHEN (CURRENT_DATE - c.fecha) <= 90 THEN '60_90'::text
            ELSE '90_plus'::text
        END AS bucket,
    c.channel_id,
    ch.name AS channel_name,
    ch.is_fiscal AS channel_is_fiscal,
    c.fch_vto_pago AS fch_vto_pago
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
  WHERE c.status = 'emitted'::text AND (c.kind = ANY (ARRAY['factura'::text, 'nd'::text])) AND (c.imp_total - COALESCE(alloc.applied, 0::numeric) - COALESCE(opening.applied, 0::numeric)) > 0::numeric;

create or replace view public.v_supplier_aging_documents with (security_invoker = on) as
  SELECT pi.id AS purchase_invoice_id,
    pi.supplier_id,
    pi.fecha,
    pi.kind,
    pi.letter,
    pi.punto_venta,
    pi.numero,
    pi.imp_total,
    COALESCE(alloc.applied, 0::numeric) AS amount_applied,
    COALESCE(nc.credited, 0::numeric) AS amount_credited_by_nc,
    pi.imp_total - COALESCE(alloc.applied, 0::numeric) - COALESCE(nc.credited, 0::numeric) AS open_amount,
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
    pi.fch_vto_pago AS fch_vto_pago
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
  WHERE pi.status = 'received'::text AND (pi.kind = ANY (ARRAY['factura'::text, 'nd'::text])) AND (pi.imp_total - COALESCE(alloc.applied, 0::numeric) - COALESCE(nc.credited, 0::numeric)) > 0::numeric;

set row_security = on;
