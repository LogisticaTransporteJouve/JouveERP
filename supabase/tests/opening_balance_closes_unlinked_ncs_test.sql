-- An opening balance closes everything up to its date, NCs with no origin
-- included (20261105200100): they are neither subtracted when it is applied
-- nor spread again by v_aging_documents onto invoices after the cut-off. An
-- unlinked NC after the cut-off still spreads. One transaction, rolled back.

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(6);

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000096c1', false, null, 'Cliente Apertura NC', null);

-- Before the cut-off: F1 100 and an unlinked NC of 30. After: F2 200 and an
-- unlinked NC of 20.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, status,
   idempotency_key, invoice_origin_id, origin_unlinked)
values
  ('00000000-0000-0000-0000-0000000096e1', 'jouve_internal', '00000000-0000-0000-0000-0000000096c1',
   'factura', null, 9001, 95001, '2026-01-05', 2, 99, '0', 100, 0, 100, 'PES', 1, 'emitted',
   'opening-nc-f1', null, false),
  ('00000000-0000-0000-0000-0000000096e2', 'jouve_internal', '00000000-0000-0000-0000-0000000096c1',
   'nc', null, 9001, 95002, '2026-01-10', 2, 99, '0', 30, 0, 30, 'PES', 1, 'emitted',
   'opening-nc-nc1', null, true),
  ('00000000-0000-0000-0000-0000000096e3', 'jouve_internal', '00000000-0000-0000-0000-0000000096c1',
   'factura', null, 9001, 95003, '2026-02-05', 2, 99, '0', 200, 0, 200, 'PES', 1, 'emitted',
   'opening-nc-f2', null, false),
  ('00000000-0000-0000-0000-0000000096e4', 'jouve_internal', '00000000-0000-0000-0000-0000000096c1',
   'nc', null, 9001, 95004, '2026-02-10', 2, 99, '0', 20, 0, 20, 'PES', 1, 'emitted',
   'opening-nc-nc2', null, true);

set constraints all immediate;

select lives_ok(
  $$select public.apply_client_opening_balance_core(
      '00000000-0000-0000-0000-0000000096c1', '2026-01-31', 0, null, null, null)$$,
  'a client opening balance at 0 is applied'
);

select is(
  (select total_settled from public.client_opening_balances
    where client_id = '00000000-0000-0000-0000-0000000096c1'),
  100::numeric,
  'the unlinked NC before the cut-off does not lower what is settled'
);

select is(
  (select coalesce(sum(open_amount), 0) from public.v_aging_documents
    where client_id = '00000000-0000-0000-0000-0000000096c1'
      and fecha <= '2026-01-31'),
  0::numeric,
  'nothing up to the cut-off stays open'
);

select is(
  (select open_amount from public.v_aging_documents
    where invoice_id = '00000000-0000-0000-0000-0000000096e3'),
  180::numeric,
  'the invoice after the cut-off takes only the unlinked NC after the cut-off'
);

select is(
  (select amount_credited_unlinked from public.v_aging_documents
    where invoice_id = '00000000-0000-0000-0000-0000000096e3'),
  20::numeric,
  'the NC inside the opening balance is not spread'
);

-- An opening balance applied before this change settled everything up to
-- the cut-off (as every one in production, from 1/11): F3 100 settled whole
-- and an unlinked NC of 40 before the cut-off. F4 after the cut-off owes all.
insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000096c2', false, null, 'Cliente Apertura Previa', null);
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, status,
   idempotency_key, invoice_origin_id, origin_unlinked)
values
  ('00000000-0000-0000-0000-0000000096e5', 'jouve_internal', '00000000-0000-0000-0000-0000000096c2',
   'factura', null, 9001, 96005, '2026-01-05', 2, 99, '0', 100, 0, 100, 'PES', 1, 'emitted',
   'opening-prev-f3', null, false),
  ('00000000-0000-0000-0000-0000000096e6', 'jouve_internal', '00000000-0000-0000-0000-0000000096c2',
   'nc', null, 9001, 96006, '2026-01-10', 2, 99, '0', 40, 0, 40, 'PES', 1, 'emitted',
   'opening-prev-nc', null, true),
  ('00000000-0000-0000-0000-0000000096e7', 'jouve_internal', '00000000-0000-0000-0000-0000000096c2',
   'factura', null, 9001, 96007, '2026-02-05', 2, 99, '0', 200, 0, 200, 'PES', 1, 'emitted',
   'opening-prev-f4', null, false);
insert into public.client_opening_balances (client_id, opening_date, target_balance, total_settled)
values ('00000000-0000-0000-0000-0000000096c2', '2026-01-31', 0, 100);
insert into public.client_opening_balance_allocations (client_id, invoice_id, amount_applied)
values ('00000000-0000-0000-0000-0000000096c2', '00000000-0000-0000-0000-0000000096e5', 100);

select is(
  (select open_amount from public.v_aging_documents
    where invoice_id = '00000000-0000-0000-0000-0000000096e7'),
  200::numeric,
  'an NC an earlier opening balance already absorbed does not pay an invoice after the cut-off'
);

select * from finish();
rollback;
