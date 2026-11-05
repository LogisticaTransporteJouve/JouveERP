-- Audit w14 S1 F1 (20261105100002): invoice_list_totals and
-- receipt_list_totals match the client name as their lists do
-- (containsPattern): %, _ and \ are literal and * is any one character.
-- 2041 has no seed data. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- The fixtures insert receipt headers by hand; in the app only
-- create_receipt does (guard_document_insert).
-- Disabled before any write, while no trigger event is pending.
alter table public.receipts disable trigger receipts_guard_insert_rpc;

select plan(9);

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000014c1c1', false, null, 'Prueba 100% w14', null),
  ('00000000-0000-0000-0000-00000014c1c2', false, null, 'Prueba 1000 w14', null),
  ('00000000-0000-0000-0000-00000014c1c3', false, null, 'Prueba_Uno w14', null),
  ('00000000-0000-0000-0000-00000014c1c4', false, null, 'PruebaXUno w14', null);

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000014c1a1', 'jouve_internal', '00000000-0000-0000-0000-00000014c1c1',
   'factura', null, 9001, 99161, '2041-01-05', 2, 99, '0', 100, 0, 100, 'emitted', 'totals-w14-1'),
  ('00000000-0000-0000-0000-00000014c1a2', 'jouve_internal', '00000000-0000-0000-0000-00000014c1c2',
   'factura', null, 9001, 99162, '2041-01-05', 2, 99, '0', 100, 0, 100, 'emitted', 'totals-w14-2'),
  ('00000000-0000-0000-0000-00000014c1a3', 'jouve_internal', '00000000-0000-0000-0000-00000014c1c3',
   'factura', null, 9001, 99163, '2041-01-05', 2, 99, '0', 100, 0, 100, 'emitted', 'totals-w14-3'),
  ('00000000-0000-0000-0000-00000014c1a4', 'jouve_internal', '00000000-0000-0000-0000-00000014c1c4',
   'factura', null, 9001, 99164, '2041-01-05', 2, 99, '0', 100, 0, 100, 'emitted', 'totals-w14-4');

insert into public.receipts
  (id, channel_id, punto_venta, numero, client_id, receipt_date, total_amount, currency)
values
  ('00000000-0000-0000-0000-00000014c1b1', 'jouve_internal', 1, 99161,
   '00000000-0000-0000-0000-00000014c1c1', '2041-01-05', 100, 'ARS'),
  ('00000000-0000-0000-0000-00000014c1b2', 'jouve_internal', 1, 99162,
   '00000000-0000-0000-0000-00000014c1c2', '2041-01-05', 100, 'ARS'),
  ('00000000-0000-0000-0000-00000014c1b3', 'jouve_internal', 1, 99163,
   '00000000-0000-0000-0000-00000014c1c3', '2041-01-05', 100, 'ARS'),
  ('00000000-0000-0000-0000-00000014c1b4', 'jouve_internal', 1, 99164,
   '00000000-0000-0000-0000-00000014c1c4', '2041-01-05', 100, 'ARS');

select is(
  public.like_contains_pattern('a\b%c_d*e'),
  '%a\\b\%c\_d_e%',
  'the pattern escapes \, % and _ and turns * into one character, as containsPattern'
);

-- Comprobantes -------------------------------------------------------------------

select is(
  (select sum(documents)::integer from public.invoice_list_totals(
     p_from => '2041-01-01', p_to => '2041-01-31', p_client_name => '100%')),
  1,
  'invoices: % is literal'
);

select is(
  (select sum(documents)::integer from public.invoice_list_totals(
     p_from => '2041-01-01', p_to => '2041-01-31', p_client_name => 'a_Uno')),
  1,
  'invoices: _ is literal'
);

select is(
  (select sum(documents)::integer from public.invoice_list_totals(
     p_from => '2041-01-01', p_to => '2041-01-31', p_client_name => 'Prueba*100')),
  2,
  'invoices: * is any one character'
);

-- Recibos ------------------------------------------------------------------------

select is(
  (select sum(documents)::integer from public.receipt_list_totals(
     p_from => '2041-01-01', p_to => '2041-01-31', p_client_name => '100%')),
  1,
  'receipts: % is literal'
);

select is(
  (select sum(documents)::integer from public.receipt_list_totals(
     p_from => '2041-01-01', p_to => '2041-01-31', p_client_name => 'a_Uno')),
  1,
  'receipts: _ is literal'
);

select is(
  (select sum(documents)::integer from public.receipt_list_totals(
     p_from => '2041-01-01', p_to => '2041-01-31', p_client_name => 'Prueba*100')),
  2,
  'receipts: * is any one character'
);

select ok(
  has_function_privilege('authenticated', 'public.like_contains_pattern(text)', 'execute')
  and has_function_privilege('service_role', 'public.like_contains_pattern(text)', 'execute')
  and not has_function_privilege('anon', 'public.like_contains_pattern(text)', 'execute'),
  'the pattern helper runs for authenticated and the service role'
);

select ok(
  (select p.provolatile = 'i' and not p.prosecdef from pg_proc p
    where p.oid = 'public.like_contains_pattern(text)'::regprocedure),
  'the pattern helper is immutable and runs as the caller'
);

select * from finish();

rollback;
