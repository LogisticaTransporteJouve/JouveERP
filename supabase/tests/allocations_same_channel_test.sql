-- guard_receipt_allocation, guard_payment_order_allocation,
-- guard_invoice_origin and guard_purchase_invoice_origin: a document only
-- settles or corrects documents of its own channel. A client or supplier is on
-- one side (guard_document_side), so the channel guards are exercised across
-- two internal channels; across sides the counterparty guard refuses first.
-- One transaction, rolled back.

begin;

select plan(12);

-- The auto-journal triggers call create_journal_entry, which wants a writer.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.invoicing_channels (id, business_unit_id, name, is_fiscal, is_active)
values ('test_internal_b', 'dz_sons', 'Interno B', false, true);

insert into public.clients (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000c001', '20111111112', 'Cliente Canal', 'responsable_inscripto');
insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000c003', false, null, 'Cliente Canal Interno', null),
  ('00000000-0000-0000-0000-00000000c002', false, null, 'Otro Cliente Interno', null);

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key)
values
  ('00000000-0000-0000-0000-0000000001f1', 'jouve_fiscal', '00000000-0000-0000-0000-00000000c001',
   'factura', 'A', 3, 1, current_date, 2, 80, '20111111112', 100, 21, 121, 1, 1, 'emitted', 'alloc-ch-f1'),
  ('00000000-0000-0000-0000-0000000001a1', 'jouve_internal', '00000000-0000-0000-0000-00000000c003',
   'factura', null, 1, 1, current_date, 2, 80, '20111111112', 100, 0, 100, null, null, 'emitted', 'alloc-ch-i1'),
  ('00000000-0000-0000-0000-0000000001b1', 'test_internal_b', '00000000-0000-0000-0000-00000000c003',
   'factura', null, 1, 1, current_date, 2, 80, '20111111112', 100, 0, 100, null, null, 'emitted', 'alloc-ch-b1');

insert into public.receipts (id, channel_id, punto_venta, numero, client_id, receipt_date, total_amount, currency) values
  ('00000000-0000-0000-0000-0000000002f1', 'jouve_fiscal', 3, 1, '00000000-0000-0000-0000-00000000c001', current_date, 121, 'ARS'),
  ('00000000-0000-0000-0000-0000000002a1', 'jouve_internal', 1, 1, '00000000-0000-0000-0000-00000000c003', current_date, 100, 'ARS');

-- Receipts -> invoices -------------------------------------------------------

select throws_ok(
  $$insert into public.receipt_allocations (receipt_id, invoice_id, amount_applied)
    values ('00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-0000000001b1', 50)$$,
  '23514',
  'El comprobante es de otro canal que el recibo: un recibo solo cancela comprobantes de su mismo canal',
  'a receipt cannot settle an invoice of another channel'
);

select throws_ok(
  $$insert into public.receipt_allocations (receipt_id, invoice_id, amount_applied)
    values ('00000000-0000-0000-0000-0000000002f1', '00000000-0000-0000-0000-0000000001a1', 50)$$,
  '23514',
  'El comprobante no pertenece al cliente del recibo',
  'a fiscal receipt cannot settle an internal invoice (its client is of the other side)'
);

select lives_ok(
  $$insert into public.receipt_allocations (receipt_id, invoice_id, amount_applied)
    values ('00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-0000000001a1', 100)$$,
  'a receipt settles an invoice of its own channel'
);

select throws_ok(
  $$insert into public.receipt_allocations (receipt_id, invoice_id, amount_applied)
    values ('00000000-0000-0000-0000-0000000002f1', '00000000-0000-0000-0000-0000000001f1', 200)$$,
  '23514',
  null,
  'the over-application check still runs after the channel check'
);

-- Payment orders -> purchase invoices ---------------------------------------

insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000b001', '30333333334', 'Proveedor Canal', 'responsable_inscripto'),
  ('00000000-0000-0000-0000-00000000b002', '30444444445', 'Otro Proveedor', 'responsable_inscripto');
insert into public.suppliers (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000b003', false, null, 'Proveedor Canal Interno', null);

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, imp_neto, imp_iva, imp_total, status)
values
  ('00000000-0000-0000-0000-0000000003f1', 'jouve_fiscal', '00000000-0000-0000-0000-00000000b001',
   'factura', 'A', 5, 10, current_date, 100, 21, 121, 'received'),
  ('00000000-0000-0000-0000-0000000003a1', 'jouve_internal', '00000000-0000-0000-0000-00000000b003',
   'factura', null, 1, 10, current_date, 100, 0, 100, 'received'),
  ('00000000-0000-0000-0000-0000000003b1', 'test_internal_b', '00000000-0000-0000-0000-00000000b003',
   'factura', null, 1, 12, current_date, 100, 0, 100, 'received'),
  ('00000000-0000-0000-0000-0000000003f2', 'jouve_fiscal', '00000000-0000-0000-0000-00000000b002',
   'factura', 'A', 5, 11, current_date, 100, 21, 121, 'received');

insert into public.payment_orders (id, channel_id, punto_venta, numero, supplier_id, payment_date, total_amount, currency) values
  ('00000000-0000-0000-0000-0000000004a1', 'jouve_internal', 1, 1, '00000000-0000-0000-0000-00000000b003', current_date, 100, 'ARS');

select throws_ok(
  $$insert into public.payment_order_allocations (payment_order_id, purchase_invoice_id, amount_applied)
    values ('00000000-0000-0000-0000-0000000004a1', '00000000-0000-0000-0000-0000000003b1', 50)$$,
  '23514',
  'La factura es de otro canal que la orden de pago: una OP solo cancela facturas de su mismo canal',
  'a payment order cannot settle a purchase invoice of another channel'
);

select lives_ok(
  $$insert into public.payment_order_allocations (payment_order_id, purchase_invoice_id, amount_applied)
    values ('00000000-0000-0000-0000-0000000004a1', '00000000-0000-0000-0000-0000000003a1', 100)$$,
  'a payment order settles a purchase invoice of its own channel'
);

-- Sales NC/ND origin ---------------------------------------------------------

select throws_ok(
  $$insert into public.invoices
      (channel_id, client_id, kind, punto_venta, fecha, concepto, doc_tipo, doc_nro,
       imp_total, invoice_origin_id, status, idempotency_key)
    values ('test_internal_b', '00000000-0000-0000-0000-00000000c003', 'nc', 1, current_date, 2, 80,
       '20111111112', 10, '00000000-0000-0000-0000-0000000001a1', 'draft', 'alloc-ch-nc1')$$,
  '23514',
  'El comprobante de origen es de otro canal: una NC/ND va en el mismo canal que su comprobante',
  'an NC cannot cite an invoice of another channel'
);

select throws_ok(
  $$insert into public.invoices
      (channel_id, client_id, kind, punto_venta, fecha, concepto, doc_tipo, doc_nro,
       imp_total, invoice_origin_id, status, idempotency_key)
    values ('jouve_internal', '00000000-0000-0000-0000-00000000c002', 'nc', 1, current_date, 2, 80,
       '20222222223', 10, '00000000-0000-0000-0000-0000000001a1', 'draft', 'alloc-ch-nc2')$$,
  '23514',
  'El comprobante de origen es de otro cliente',
  'an NC cannot cite another client''s invoice'
);

select lives_ok(
  $$insert into public.invoices
      (channel_id, client_id, kind, punto_venta, fecha, concepto, doc_tipo, doc_nro,
       imp_total, invoice_origin_id, status, idempotency_key)
    values ('jouve_internal', '00000000-0000-0000-0000-00000000c003', 'nc', 1, current_date, 2, 80,
       '20111111112', 10, '00000000-0000-0000-0000-0000000001a1', 'draft', 'alloc-ch-nc3')$$,
  'an NC cites an invoice of its own channel and client'
);

-- Purchase NC/ND origin -------------------------------------------------------

select throws_ok(
  $$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_total, invoice_origin_id, status)
    values ('test_internal_b', '00000000-0000-0000-0000-00000000b003', 'nc', 1, 20, current_date, 10,
       '00000000-0000-0000-0000-0000000003a1', 'received')$$,
  '23514',
  'La factura de origen es de otro canal: una NC/ND va en el mismo canal que su factura',
  'a purchase NC cannot cite a purchase invoice of another channel'
);

select throws_ok(
  $$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, imp_total, invoice_origin_id, status)
    values ('jouve_fiscal', '00000000-0000-0000-0000-00000000b001', 'nc', 'A', 5, 21, current_date, 10,
       '00000000-0000-0000-0000-0000000003f2', 'received')$$,
  '23514',
  'La factura de origen es de otro proveedor',
  'a purchase NC cannot cite another supplier''s invoice'
);

insert into public.purchase_invoices
  (channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_total, invoice_origin_id, status)
values ('jouve_internal', '00000000-0000-0000-0000-00000000b003', 'nc', 1, 22, current_date, 10,
  '00000000-0000-0000-0000-0000000003a1', 'received');

select throws_ok(
  $$update public.purchase_invoices set channel_id = 'test_internal_b'
     where id = '00000000-0000-0000-0000-0000000003a1'$$,
  '23514',
  'Esta factura es origen de una NC/ND: no se le puede cambiar el canal ni el proveedor',
  'the origin of an NC cannot move to another channel'
);

select * from finish();

rollback;
