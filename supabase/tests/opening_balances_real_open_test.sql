-- Opening balances settle what is really open at the cut-off
-- (20261104094100): the supplier's subtracts payment orders and NCs (it
-- ignored both), the client's FIFO skips an invoice an NC already credited,
-- and both leave dollar comprobantes out of a peso balance. One transaction,
-- rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(10);

-- The fixtures insert payment-order headers by hand; in the app only
-- create_payment_order do (guard_document_insert).
-- Disabled before any write, while no trigger event is pending.
alter table public.payment_orders disable trigger payment_orders_guard_insert_rpc;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000094f1', 'owner@opening-real-open.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000094f1', 'owner');

insert into public.suppliers (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000094b1', false, null, 'Proveedor Apertura Real', null);
insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000094c1', false, null, 'Cliente Apertura Real', null);

-- Supplier ------------------------------------------------------------------

-- F1 1.000 (600 paid by an OP), F2 500 (100 credited by an NC), F3 USD 1.000.
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, fch_vto_pago,
   imp_neto, imp_total, moneda, cotizacion, status, invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000000094a1', 'jouve_internal', '00000000-0000-0000-0000-0000000094b1',
   'factura', null, 9, 94001, '2026-01-10', '2026-01-10', 1000, 1000, 'PES', 1, 'received', null),
  ('00000000-0000-0000-0000-0000000094a2', 'jouve_internal', '00000000-0000-0000-0000-0000000094b1',
   'factura', null, 9, 94002, '2026-01-20', '2026-01-20', 500, 500, 'PES', 1, 'received', null),
  ('00000000-0000-0000-0000-0000000094a3', 'jouve_internal', '00000000-0000-0000-0000-0000000094b1',
   'factura', null, 9, 94003, '2026-01-05', '2026-01-05', 1000, 1000, 'DOL', 1000, 'received', null);
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, fch_vto_pago,
   imp_neto, imp_total, moneda, cotizacion, status, invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000000094a4', 'jouve_internal', '00000000-0000-0000-0000-0000000094b1',
   'nc', null, 9, 94004, '2026-01-25', '2026-01-25', 100, 100, 'PES', 1, 'received',
   '00000000-0000-0000-0000-0000000094a2');

insert into public.payment_orders (id, channel_id, punto_venta, numero, supplier_id, payment_date, total_amount, currency)
values ('00000000-0000-0000-0000-0000000094d1', 'jouve_internal', 9, 94001,
        '00000000-0000-0000-0000-0000000094b1', '2026-01-15', 600, 'ARS');
insert into public.payment_order_allocations (payment_order_id, purchase_invoice_id, amount_applied)
values ('00000000-0000-0000-0000-0000000094d1', '00000000-0000-0000-0000-0000000094a1', 600);

set constraints all immediate;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000094f1","role":"authenticated"}', true);

-- Really owed at the cut-off: 1.000 + 500 − 100 − 600 = 800. Target 400, so
-- 400 is settled: F1's 400 left by the OP; F2 keeps 400 open.
select lives_ok(
  $$select public.apply_supplier_opening_balance(
      '00000000-0000-0000-0000-0000000094b1', '2026-01-31', 400, null)$$,
  'the owner applies a supplier opening balance that has something to settle'
);

select is(
  (select total_settled from public.supplier_opening_balances
    where supplier_id = '00000000-0000-0000-0000-0000000094b1'),
  400::numeric,
  'the supplier settles real open (invoices − NCs − payment orders) minus the target'
);

select is(
  (select coalesce(sum(open_amount), 0) from public.v_supplier_aging_documents
    where supplier_id = '00000000-0000-0000-0000-0000000094b1'
      and coalesce(moneda, 'PES') = 'PES'),
  400::numeric,
  'the supplier''s peso aging equals the target'
);

select is(
  (select open_amount from public.v_supplier_aging_documents
    where purchase_invoice_id = '00000000-0000-0000-0000-0000000094a3'),
  1000::numeric,
  'a dollar purchase is not settled by a peso opening balance'
);

-- Client --------------------------------------------------------------------

-- A 100 credited in full by a linked NC, B 100 open, U a USD factura of 50.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, status,
   idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000000094e1', 'jouve_internal', '00000000-0000-0000-0000-0000000094c1',
   'factura', null, 9001, 94001, '2026-01-05', 2, 99, '0', 100, 0, 100, 'PES', 1, 'emitted',
   'opening-real-open-a', null),
  ('00000000-0000-0000-0000-0000000094e2', 'jouve_internal', '00000000-0000-0000-0000-0000000094c1',
   'factura', null, 9001, 94002, '2026-01-06', 2, 99, '0', 100, 0, 100, 'PES', 1, 'emitted',
   'opening-real-open-b', null),
  ('00000000-0000-0000-0000-0000000094e3', 'jouve_internal', '00000000-0000-0000-0000-0000000094c1',
   'factura', null, 9001, 94003, '2026-01-04', 2, 99, '0', 50, 0, 50, 'DOL', 1000, 'emitted',
   'opening-real-open-u', null);
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, status,
   idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000000094e4', 'jouve_internal', '00000000-0000-0000-0000-0000000094c1',
   'nc', null, 9001, 94004, '2026-01-07', 2, 99, '0', 100, 0, 100, 'PES', 1, 'emitted',
   'opening-real-open-nc', '00000000-0000-0000-0000-0000000094e1');

set constraints all immediate;

-- Real open in pesos: 200 − 100 = 100; target 0, so 100 is settled.
select lives_ok(
  $$select public.apply_client_opening_balance_core(
      '00000000-0000-0000-0000-0000000094c1', '2026-01-31', 0, null, null, null)$$,
  'a client opening balance is applied'
);

select is(
  (select amount_applied from public.client_opening_balance_allocations
    where invoice_id = '00000000-0000-0000-0000-0000000094e2'),
  100::numeric,
  'the FIFO settles the invoice the NC left open'
);

select is(
  (select count(*)::int from public.client_opening_balance_allocations
    where invoice_id in ('00000000-0000-0000-0000-0000000094e1', '00000000-0000-0000-0000-0000000094e3')),
  0,
  'and skips the invoice the NC credited and the dollar invoice'
);

select is(
  (select coalesce(sum(open_amount), 0) from public.v_aging_documents
    where client_id = '00000000-0000-0000-0000-0000000094c1'
      and coalesce(moneda, 'PES') = 'PES'),
  0::numeric,
  'the client''s peso aging equals the target'
);

select is(
  (select open_amount from public.v_aging_documents
    where invoice_id = '00000000-0000-0000-0000-0000000094e3'),
  50::numeric,
  'the dollar invoice keeps its open amount'
);

-- A draft NC of 40 against B reserves part of it: re-applied, the FIFO can
-- only put 60 on B, and total_settled says 60, not the 100 it aimed at.
-- First a target of 100, which settles nothing, frees B for the NC.
select public.apply_client_opening_balance_core(
  '00000000-0000-0000-0000-0000000094c1', '2026-01-31', 100, null, null, null);
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, status,
   idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000000094e5', 'jouve_internal', '00000000-0000-0000-0000-0000000094c1',
   'nc', null, 9001, null, '2026-01-08', 2, 99, '0', 40, 0, 40, 'PES', 1, 'draft',
   'opening-real-open-draft-nc', '00000000-0000-0000-0000-0000000094e2');

set constraints all immediate;

select public.apply_client_opening_balance_core(
  '00000000-0000-0000-0000-0000000094c1', '2026-01-31', 0, null, null, null);

select results_eq(
  $$select b.total_settled, a.amount_applied
      from public.client_opening_balances b
      join public.client_opening_balance_allocations a on a.client_id = b.client_id
     where b.client_id = '00000000-0000-0000-0000-0000000094c1'$$,
  $$values (60::numeric, 60::numeric)$$,
  'total_settled is what the FIFO applied when the invoices take less'
);

select * from finish();

rollback;
