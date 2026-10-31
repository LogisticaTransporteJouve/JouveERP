-- fiscal_reader: reads fiscal documents and nothing internal; writes nothing.
-- One transaction, rolled back.

begin;

select plan(16);

-- The auto-journal triggers call create_journal_entry, which wants a writer.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000fa', 'contador@fiscal-reader.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000000fa', 'fiscal_reader');

insert into public.clients (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000fc01', '20111111112', 'Cliente Contador', 'responsable_inscripto');
insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000fd01', '30555555556', 'Proveedor Contador', 'responsable_inscripto');

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key)
values
  ('00000000-0000-0000-0000-0000000fa0f1', 'jouve_fiscal', '00000000-0000-0000-0000-00000000fc01',
   'factura', 'A', 3, 99991, current_date, 2, 80, '20111111112', 100, 21, 121, 1, 1, 'emitted', 'fr-f1'),
  ('00000000-0000-0000-0000-0000000fa0a1', 'jouve_internal', '00000000-0000-0000-0000-00000000fc01',
   'factura', null, 1, 99991, current_date, 2, 80, '20111111112', 100, 0, 100, null, null, 'emitted', 'fr-i1');

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, imp_neto, imp_iva, imp_total, status)
values
  ('00000000-0000-0000-0000-0000000fb0f1', 'jouve_fiscal', '00000000-0000-0000-0000-00000000fd01',
   'factura', 'A', 1, 99991, current_date, 100, 21, 121, 'received'),
  ('00000000-0000-0000-0000-0000000fb0a1', 'jouve_internal', '00000000-0000-0000-0000-00000000fd01',
   'factura', null, 1, 99992, current_date, 50, 0, 50, 'received');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000fa","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.invoices where id = '00000000-0000-0000-0000-0000000fa0f1'),
  1, 'a fiscal_reader reads a fiscal invoice');
select is(
  (select count(*)::int from public.invoices where id = '00000000-0000-0000-0000-0000000fa0a1'),
  0, 'a fiscal_reader cannot read an internal invoice');
select is(
  (select count(*)::int from public.invoices i
     join public.invoicing_channels ch on ch.id = i.channel_id where not ch.is_fiscal),
  0, 'no internal invoice is visible at all');
select is(
  (select count(*)::int from public.purchase_invoices where id = '00000000-0000-0000-0000-0000000fb0f1'),
  1, 'a fiscal_reader reads a fiscal purchase invoice');
select is(
  (select count(*)::int from public.purchase_invoices where id = '00000000-0000-0000-0000-0000000fb0a1'),
  0, 'a fiscal_reader cannot read an internal purchase invoice');
select is(
  (select count(*)::int from public.invoicing_channels where not is_fiscal),
  0, 'internal channels are hidden');
select ok(
  (select count(*) from public.invoicing_channels where id = 'jouve_fiscal') = 1,
  'the fiscal channel is visible');
select is(
  (select count(*)::int from public.journal_entries je
     join public.invoicing_channels ch on ch.id = je.channel_id where not ch.is_fiscal),
  0, 'no journal entry of an internal channel is visible');
select ok(
  (select count(*) from public.clients where id = '00000000-0000-0000-0000-00000000fc01') = 1
  and (select count(*) from public.suppliers where id = '00000000-0000-0000-0000-00000000fd01') = 1,
  'clients and suppliers are readable');
select is(
  (select count(*)::int from public.receipts) + (select count(*)::int from public.transactions)
    + (select count(*)::int from public.accounts) + (select count(*)::int from public.payment_orders),
  0, 'internal-only data (receipts, cash, payment orders) is not readable');

select throws_ok(
  $$insert into public.clients (cuit, legal_name, iva_condition)
    values ('20333333334', 'Cliente Nuevo', 'responsable_inscripto')$$,
  '42501', null, 'a fiscal_reader cannot create a client');
select throws_ok(
  $$insert into public.invoices
      (channel_id, client_id, kind, punto_venta, fecha, concepto, doc_tipo, doc_nro, imp_total, status, idempotency_key)
    values ('jouve_internal', '00000000-0000-0000-0000-00000000fc01', 'factura', 1, current_date, 2, 80,
            '20111111112', 10, 'draft', 'fr-new')$$,
  null, null, 'a fiscal_reader cannot create an invoice (a channel trigger or RLS rejects it)');
select throws_ok(
  $$insert into public.journal_entries (entry_date, description, channel_id)
    values (current_date, 'x', 'jouve_fiscal')$$,
  '42501', null, 'a fiscal_reader cannot create a journal entry');

update public.invoices set imp_total = 1 where id = '00000000-0000-0000-0000-0000000fa0f1';
update public.clients set legal_name = 'Cambiado' where id = '00000000-0000-0000-0000-00000000fc01';
delete from public.purchase_invoices where id = '00000000-0000-0000-0000-0000000fb0f1';

reset role;

select is(
  (select imp_total from public.invoices where id = '00000000-0000-0000-0000-0000000fa0f1'),
  121::numeric, 'an update by a fiscal_reader changes nothing');
select is(
  (select legal_name from public.clients where id = '00000000-0000-0000-0000-00000000fc01'),
  'Cliente Contador', 'nor does a client update');
select is(
  (select count(*)::int from public.purchase_invoices where id = '00000000-0000-0000-0000-0000000fb0f1'),
  1, 'and a delete removes nothing');

select * from finish();
rollback;
