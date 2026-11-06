-- Opening balances in dollars (20261106222124): with a dollar target the
-- supplier's and the client's opening settle the dollar documents up to the
-- cut-off down to it, pesos are settled as before, and without one the
-- dollar target already set is applied again, or (with none) the dollar
-- allocations stay as they are. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(21);

-- The fixtures insert payment-order and receipt headers by hand; in the app
-- only their RPCs do (guard_document_insert). Disabled before any write,
-- while no trigger event is pending.
alter table public.payment_orders disable trigger payment_orders_guard_insert_rpc;
alter table public.receipts disable trigger receipts_guard_insert_rpc;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000097f1', 'owner@opening-usd.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000097f1', 'owner');

insert into public.suppliers (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000097b1', false, null, 'Proveedor Apertura USD', null),
  ('00000000-0000-0000-0000-0000000097b2', false, null, 'Proveedor USD a mano', null);
insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000097c1', false, null, 'Cliente Apertura USD', null);

-- Supplier ------------------------------------------------------------------

-- P1 $1.000; U1 US$1.000 (200 paid by a dollar OP), U2 US$500 (100 credited
-- by an NC), U3 US$300 after the cut-off.
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, fch_vto_pago,
   imp_neto, imp_total, moneda, cotizacion, status, invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000000097a1', 'jouve_internal', '00000000-0000-0000-0000-0000000097b1',
   'factura', null, 9, 97001, '2026-01-02', '2026-01-02', 1000, 1000, 'PES', 1, 'received', null),
  ('00000000-0000-0000-0000-0000000097a2', 'jouve_internal', '00000000-0000-0000-0000-0000000097b1',
   'factura', null, 9, 97002, '2026-01-05', '2026-01-05', 1000, 1000, 'DOL', 1000, 'received', null),
  ('00000000-0000-0000-0000-0000000097a3', 'jouve_internal', '00000000-0000-0000-0000-0000000097b1',
   'factura', null, 9, 97003, '2026-01-10', '2026-01-10', 500, 500, 'DOL', 1000, 'received', null),
  ('00000000-0000-0000-0000-0000000097a4', 'jouve_internal', '00000000-0000-0000-0000-0000000097b1',
   'factura', null, 9, 97004, '2026-02-10', '2026-02-10', 300, 300, 'DOL', 1000, 'received', null),
  ('00000000-0000-0000-0000-0000000097a6', 'jouve_internal', '00000000-0000-0000-0000-0000000097b2',
   'factura', null, 9, 97006, '2026-01-07', '2026-01-07', 700, 700, 'DOL', 1000, 'received', null);
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, fch_vto_pago,
   imp_neto, imp_total, moneda, cotizacion, status, invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000000097a5', 'jouve_internal', '00000000-0000-0000-0000-0000000097b1',
   'nc', null, 9, 97005, '2026-01-12', '2026-01-12', 100, 100, 'DOL', 1000, 'received',
   '00000000-0000-0000-0000-0000000097a3');

insert into public.payment_orders (id, channel_id, punto_venta, numero, supplier_id, payment_date, total_amount, currency, cotizacion)
values ('00000000-0000-0000-0000-0000000097d1', 'jouve_internal', 9, 97001,
        '00000000-0000-0000-0000-0000000097b1', '2026-01-15', 200, 'USD', 1000);
insert into public.payment_order_allocations (payment_order_id, purchase_invoice_id, amount_applied)
values ('00000000-0000-0000-0000-0000000097d1', '00000000-0000-0000-0000-0000000097a2', 200);

set constraints all immediate;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000097f1","role":"authenticated"}', true);

-- Without a dollar target (the four arguments older code passes): pesos
-- only, as before.
select public.apply_supplier_opening_balance(
  '00000000-0000-0000-0000-0000000097b1', '2026-01-31', 0, null);

select results_eq(
  $$select target_balance_usd, total_settled_usd from public.supplier_opening_balances
     where supplier_id = '00000000-0000-0000-0000-0000000097b1'$$,
  $$values (null::numeric, null::numeric)$$,
  'without a dollar target the opening has none'
);

select is(
  (select coalesce(sum(open_amount), 0) from public.v_supplier_aging_documents
    where supplier_id = '00000000-0000-0000-0000-0000000097b1' and moneda = 'DOL'),
  1500::numeric,
  'and the dollar purchases stay open (800 + 400 + 300)'
);

-- Real open in dollars up to the cut-off: 1.500 − 100 − 200 = 1.200. Target
-- 100, so 1.100 is settled: U1's 800, then 300 of U2's 400.
select lives_ok(
  $$select public.apply_supplier_opening_balance(
      '00000000-0000-0000-0000-0000000097b1', '2026-01-31', 0, null, 100)$$,
  'the owner applies a supplier opening balance with a dollar target'
);

select results_eq(
  $$select target_balance, total_settled, target_balance_usd, total_settled_usd
      from public.supplier_opening_balances
     where supplier_id = '00000000-0000-0000-0000-0000000097b1'$$,
  $$values (0::numeric, 1000::numeric, 100::numeric, 1100::numeric)$$,
  'pesos settle as before and the dollars settle real open minus the dollar target'
);

select is(
  (select coalesce(sum(open_amount), 0) from public.v_supplier_aging_documents
    where supplier_id = '00000000-0000-0000-0000-0000000097b1' and moneda = 'DOL'
      and fecha <= '2026-01-31'),
  100::numeric,
  'the supplier''s dollar aging up to the cut-off equals the dollar target'
);

select is(
  (select open_amount from public.v_supplier_aging_documents
    where purchase_invoice_id = '00000000-0000-0000-0000-0000000097a4'),
  300::numeric,
  'a dollar purchase after the cut-off is not settled'
);

select results_eq(
  $$select currency, signed_amount from public.v_supplier_account_movements
     where supplier_id = '00000000-0000-0000-0000-0000000097b1' and source_type = 'opening_balance'
     order by currency$$,
  $$values ('ARS'::text, 0::numeric), ('USD'::text, 100::numeric)$$,
  'the statement lists the opening once per currency'
);

-- Re-applied in pesos only: the dollar target already set is applied again,
-- nothing is settled twice.
select public.apply_supplier_opening_balance(
  '00000000-0000-0000-0000-0000000097b1', '2026-01-31', 0, null);

select results_eq(
  $$select b.target_balance_usd, b.total_settled_usd,
           (select sum(a.amount_applied) from public.supplier_opening_balance_allocations a
             where a.supplier_id = b.supplier_id)
      from public.supplier_opening_balances b
     where b.supplier_id = '00000000-0000-0000-0000-0000000097b1'$$,
  $$values (100::numeric, 1100::numeric, 2100::numeric)$$,
  're-applied without a dollar target, the dollar one set is kept and settles the same'
);

select throws_ok(
  $$select public.apply_supplier_opening_balance(
      '00000000-0000-0000-0000-0000000097b1', '2026-01-31', 0, null, -1)$$,
  '22023',
  'El saldo de apertura en dólares no puede ser negativo',
  'a negative dollar target is refused'
);

-- A dollar purchase settled by hand under a peso-only opening (as done in
-- production on 2026-11-06).
select public.apply_supplier_opening_balance(
  '00000000-0000-0000-0000-0000000097b2', '2026-01-31', 0, null);
insert into public.supplier_opening_balance_allocations (supplier_id, purchase_invoice_id, amount_applied)
values ('00000000-0000-0000-0000-0000000097b2', '00000000-0000-0000-0000-0000000097a6', 700);

select public.apply_supplier_opening_balance(
  '00000000-0000-0000-0000-0000000097b2', '2026-01-31', 0, null);

select is(
  (select amount_applied from public.supplier_opening_balance_allocations
    where purchase_invoice_id = '00000000-0000-0000-0000-0000000097a6'),
  700::numeric,
  're-applied in pesos only, the dollar settlement loaded by hand stays'
);

select public.apply_supplier_opening_balance(
  '00000000-0000-0000-0000-0000000097b2', '2026-01-31', 0, null, 0);

select results_eq(
  $$select b.total_settled_usd, a.amount_applied
      from public.supplier_opening_balances b
      join public.supplier_opening_balance_allocations a on a.supplier_id = b.supplier_id
     where b.supplier_id = '00000000-0000-0000-0000-0000000097b2'$$,
  $$values (700::numeric, 700::numeric)$$,
  'a dollar target of 0 recomputes the hand settlement instead of adding to it'
);

select is(
  (select count(*)::int from public.v_supplier_aging_documents
    where supplier_id = '00000000-0000-0000-0000-0000000097b2'),
  0,
  'and the purchase reads settled'
);

-- Client --------------------------------------------------------------------

-- P $100; U1 US$50 (30 collected by a dollar receipt), U2 US$80, an
-- unlinked dollar NC of 20 up to the cut-off, U3 US$40 after it.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, status,
   idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000000097e1', 'jouve_internal', '00000000-0000-0000-0000-0000000097c1',
   'factura', null, 9001, 97001, '2026-01-03', 2, 99, '0', 100, 0, 100, 'PES', 1, 'emitted',
   'opening-usd-p', null),
  ('00000000-0000-0000-0000-0000000097e2', 'jouve_internal', '00000000-0000-0000-0000-0000000097c1',
   'factura', null, 9001, 97002, '2026-01-04', 2, 99, '0', 50, 0, 50, 'DOL', 1000, 'emitted',
   'opening-usd-u1', null),
  ('00000000-0000-0000-0000-0000000097e3', 'jouve_internal', '00000000-0000-0000-0000-0000000097c1',
   'factura', null, 9001, 97003, '2026-01-06', 2, 99, '0', 80, 0, 80, 'DOL', 1000, 'emitted',
   'opening-usd-u2', null),
  ('00000000-0000-0000-0000-0000000097e5', 'jouve_internal', '00000000-0000-0000-0000-0000000097c1',
   'factura', null, 9001, 97005, '2026-02-06', 2, 99, '0', 40, 0, 40, 'DOL', 1000, 'emitted',
   'opening-usd-u3', null);
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, status,
   idempotency_key, invoice_origin_id, origin_unlinked)
values
  ('00000000-0000-0000-0000-0000000097e4', 'jouve_internal', '00000000-0000-0000-0000-0000000097c1',
   'nc', null, 9001, 97004, '2026-01-08', 2, 99, '0', 20, 0, 20, 'DOL', 1000, 'emitted',
   'opening-usd-nc', null, true);

insert into public.receipts (id, channel_id, punto_venta, numero, client_id, receipt_date, total_amount, currency, cotizacion)
values ('00000000-0000-0000-0000-0000000097d2', 'jouve_internal', 9, 97001,
        '00000000-0000-0000-0000-0000000097c1', '2026-01-10', 30, 'USD', 1000);
insert into public.receipt_allocations (receipt_id, invoice_id, amount_applied)
values ('00000000-0000-0000-0000-0000000097d2', '00000000-0000-0000-0000-0000000097e2', 30);

set constraints all immediate;

-- Real open in dollars: 130 − 30 = 100 (the unlinked NC stays inside the
-- opening, as in pesos). Target 10, so 90 is settled: U1's 20, then 70 of
-- U2's 80.
select lives_ok(
  $$select public.apply_client_opening_balance(
      '00000000-0000-0000-0000-0000000097c1', '2026-01-31', 0, null, 10)$$,
  'the owner applies a client opening balance with a dollar target'
);

select results_eq(
  $$select target_balance, total_settled, target_balance_usd, total_settled_usd
      from public.client_opening_balances
     where client_id = '00000000-0000-0000-0000-0000000097c1'$$,
  $$values (0::numeric, 100::numeric, 10::numeric, 90::numeric)$$,
  'pesos settle as before and the dollars settle real open minus the dollar target'
);

select results_eq(
  $$select invoice_id, amount_applied from public.client_opening_balance_allocations
     where client_id = '00000000-0000-0000-0000-0000000097c1'
     order by amount_applied$$,
  $$values ('00000000-0000-0000-0000-0000000097e2'::uuid, 20::numeric),
           ('00000000-0000-0000-0000-0000000097e3'::uuid, 70::numeric),
           ('00000000-0000-0000-0000-0000000097e1'::uuid, 100::numeric)$$,
  'the dollar FIFO goes over what receipts leave open, oldest first'
);

select is(
  (select coalesce(sum(open_amount), 0) from public.v_aging_documents
    where client_id = '00000000-0000-0000-0000-0000000097c1' and moneda = 'DOL'
      and fecha <= '2026-01-31'),
  10::numeric,
  'the client''s dollar aging up to the cut-off equals the dollar target'
);

select is(
  (select open_amount from public.v_aging_documents
    where invoice_id = '00000000-0000-0000-0000-0000000097e5'),
  40::numeric,
  'the unlinked dollar NC inside the opening is not spread onto a later invoice'
);

select results_eq(
  $$select currency, signed_amount from public.v_client_account_movements
     where client_id = '00000000-0000-0000-0000-0000000097c1' and source_type = 'opening_balance'
     order by currency$$,
  $$values ('ARS'::text, 0::numeric), ('USD'::text, 10::numeric)$$,
  'the client statement lists the opening once per currency'
);

-- The importer's positional call (six arguments) still resolves, and keeps
-- the dollar target already set.
select lives_ok(
  $$select public.apply_client_opening_balance_core(
      '00000000-0000-0000-0000-0000000097c1', '2026-01-31', 0, null, null, null)$$,
  'the six-argument core call still works'
);

select is(
  (select total_settled_usd from public.client_opening_balances
    where client_id = '00000000-0000-0000-0000-0000000097c1'),
  90::numeric,
  'and re-applies the dollar target without settling twice'
);

select throws_ok(
  $$select public.apply_client_opening_balance(
      '00000000-0000-0000-0000-0000000097c1', '2026-01-31', 0, null, -5)$$,
  '22023',
  'El saldo de apertura en dólares no puede ser negativo',
  'a negative dollar target is refused on the client too'
);

select * from finish();

rollback;
