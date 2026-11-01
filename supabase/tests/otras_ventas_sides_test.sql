-- Otras ventas / Otras compras (docs/otras-ventas.md): counterparty sides,
-- guard_document_side, guard_invoice_source_remito, the one-live-factura index,
-- move_billed_remito_receipts, fiscal_reader on clients/suppliers and the ACLs
-- of the new functions. One transaction, rolled back.

begin;

select plan(44);

-- The auto-journal triggers call create_journal_entry, which wants a writer.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005fa', 'contador@otras-ventas.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000005fa', 'fiscal_reader');

-- Fixtures -----------------------------------------------------------------

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000005c0f1', true, '20999999992', 'Cliente Ventas OV', 'responsable_inscripto'),
  ('00000000-0000-0000-0000-00000005c0a1', false, null, 'Cliente Otras ventas OV', null);
insert into public.suppliers (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000005d0f1', true, '30999999993', 'Proveedor Compras OV', 'responsable_inscripto'),
  ('00000000-0000-0000-0000-00000005d0a1', false, null, 'Proveedor Otras compras OV', null);
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000005ac01', 'Caja OV Test', 'cash', 'ARS');

-- 1. clients_side_identity / suppliers_side_identity ---------------------------

select throws_ok(
  $$insert into public.clients (is_fiscal, cuit, legal_name, iva_condition)
    values (false, '20888888881', 'Interno con CUIT', null)$$,
  '23514', null, 'an internal client cannot carry a CUIT');
select throws_ok(
  $$insert into public.clients (is_fiscal, cuit, legal_name, iva_condition)
    values (false, null, 'Interno con IVA', 'monotributo')$$,
  '23514', null, 'an internal client cannot carry an IVA condition');
select throws_ok(
  $$insert into public.clients (is_fiscal, cuit, legal_name, iva_condition)
    values (true, null, 'Fiscal sin CUIT', 'responsable_inscripto')$$,
  '23514', null, 'a fiscal client needs a CUIT');
select throws_ok(
  $$insert into public.clients (cuit, legal_name, iva_condition)
    values ('20888888881', 'Fiscal sin IVA', null)$$,
  '23514', null, 'a fiscal client (the default side) needs an IVA condition');
select lives_ok(
  $$insert into public.clients (is_fiscal, legal_name) values (false, 'Interno dos OV'), (false, 'Interno tres OV')$$,
  'several internal clients without CUIT coexist (NULLs never collide on UNIQUE cuit)');
select throws_ok(
  $$insert into public.suppliers (is_fiscal, cuit, legal_name, iva_condition)
    values (false, '30888888882', 'Prov interno con CUIT', null)$$,
  '23514', null, 'an internal supplier cannot carry a CUIT');
select throws_ok(
  $$update public.clients set cuit = '20888888881'
    where id = '00000000-0000-0000-0000-00000005c0a1'$$,
  '23514', null, 'an update cannot give an internal client a CUIT');

-- 2. The side never changes --------------------------------------------------

select throws_ok(
  $$update public.clients set is_fiscal = true, cuit = '20888888881', iva_condition = 'monotributo'
    where id = '00000000-0000-0000-0000-00000005c0a1'$$,
  '23514', null, 'an internal client cannot become fiscal');
select throws_ok(
  $$update public.clients set is_fiscal = false, cuit = null, iva_condition = null
    where id = '00000000-0000-0000-0000-00000005c0f1'$$,
  '23514', null, 'a fiscal client cannot become internal');
select throws_ok(
  $$update public.suppliers set is_fiscal = true, cuit = '30888888882', iva_condition = 'monotributo'
    where id = '00000000-0000-0000-0000-00000005d0a1'$$,
  '23514', null, 'an internal supplier cannot become fiscal');
select lives_ok(
  $$update public.clients set legal_name = 'Cliente Otras ventas OV editado'
    where id = '00000000-0000-0000-0000-00000005c0a1'$$,
  'other columns of an internal client stay editable');

-- 3. guard_document_side -----------------------------------------------------

select throws_ok(
  $$insert into public.invoices
      (channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
       doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key)
    values ('jouve_internal', '00000000-0000-0000-0000-00000005c0f1', 'factura', null, 9001, 99950,
       current_date, 2, 99, '0', 100, 0, 100, 'emitted', 'ov-side-1')$$,
  '23514', 'Un comprobante de Otras ventas necesita un cliente de Otras ventas.',
  'a remito interno cannot go to a fiscal client');
select throws_ok(
  $$insert into public.invoices
      (channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
       doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, cbte_tipo_afip,
       iva_condition_receptor, status, idempotency_key)
    values ('jouve_fiscal', '00000000-0000-0000-0000-00000005c0a1', 'factura', 'B', 3, 99950,
       current_date, 2, 99, '0', 100, 21, 121, 6, 5, 'draft', 'ov-side-2')$$,
  '23514', 'Un comprobante de Ventas necesita un cliente de Ventas.',
  'a fiscal factura cannot go to an internal client');
select throws_ok(
  $$insert into public.receipts (channel_id, punto_venta, numero, client_id, receipt_date, total_amount, currency)
    values ('jouve_internal', 9001, 99950, '00000000-0000-0000-0000-00000005c0f1', current_date, 10, 'ARS')$$,
  '23514', null, 'a recibo interno cannot go to a fiscal client');
select throws_ok(
  $$insert into public.receipts (channel_id, punto_venta, numero, client_id, receipt_date, total_amount, currency)
    values ('jouve_fiscal', 3, 99950, '00000000-0000-0000-0000-00000005c0a1', current_date, 10, 'ARS')$$,
  '23514', null, 'a fiscal recibo cannot go to an internal client');
select throws_ok(
  $$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_total, status)
    values ('jouve_internal', '00000000-0000-0000-0000-00000005d0f1', 'factura', 1, 99950, current_date, 10, 'received')$$,
  '23514', 'Un comprobante de Otras compras necesita un proveedor de Otras compras.',
  'an internal purchase cannot come from a fiscal supplier');
select throws_ok(
  $$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, imp_total, status)
    values ('jouve_fiscal', '00000000-0000-0000-0000-00000005d0a1', 'factura', 'A', 1, 99950, current_date, 10, 'received')$$,
  '23514', 'Un comprobante de Compras necesita un proveedor de Compras.',
  'a fiscal purchase cannot come from an internal supplier');
select throws_ok(
  $$insert into public.payment_orders (channel_id, punto_venta, numero, supplier_id, payment_date, total_amount, currency)
    values ('jouve_internal', 1, 99950, '00000000-0000-0000-0000-00000005d0f1', current_date, 10, 'ARS')$$,
  '23514', null, 'an internal payment order cannot pay a fiscal supplier');
select lives_ok(
  $$insert into public.purchase_invoices
      (id, channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_total, status)
    values ('00000000-0000-0000-0000-00000005b0a1', 'jouve_internal', '00000000-0000-0000-0000-00000005d0a1',
       'factura', 1, 99951, current_date, 10, 'received')$$,
  'an internal purchase from an internal supplier is accepted');
select throws_ok(
  $$update public.purchase_invoices set supplier_id = '00000000-0000-0000-0000-00000005d0f1'
    where id = '00000000-0000-0000-0000-00000005b0a1'$$,
  '23514', null, 'an update cannot move a document to a counterparty of the other side');

-- The remito, its recibo interno and the factura that bills it ---------------

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000005e0a1', 'jouve_internal', '00000000-0000-0000-0000-00000005c0a1',
   'factura', null, 9001, 99952, current_date, 2, 99, '0', 1000, 0, 1000, 'emitted', 'ov-remito'),
  ('00000000-0000-0000-0000-00000005e0a2', 'jouve_internal', '00000000-0000-0000-0000-00000005c0a1',
   'factura', null, 9001, null, current_date, 2, 99, '0', 500, 0, 500, 'draft', 'ov-remito-draft');

select lives_ok(
  $$select public.create_receipt('jouve_internal', 9001, 99952, '00000000-0000-0000-0000-00000005c0a1',
      current_date, 600, 'ARS', 'recibo interno OV',
      '[{"account_id":"00000000-0000-0000-0000-00000005ac01","amount":600}]'::jsonb,
      '[{"invoice_id":"00000000-0000-0000-0000-00000005e0a1","amount_applied":600}]'::jsonb,
      '[]'::jsonb)$$,
  'a recibo interno collects 600 of the remito');

-- 4. guard_invoice_source_remito ---------------------------------------------

select throws_ok(
  $$insert into public.invoices
      (channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
       doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, cbte_tipo_afip,
       iva_condition_receptor, status, idempotency_key, source_remito_id)
    values ('jouve_internal', '00000000-0000-0000-0000-00000005c0a1', 'factura', null, 9001, null,
       current_date, 2, 99, '0', 1000, 0, 1000, null, null, 'draft', 'ov-src-1',
       '00000000-0000-0000-0000-00000005e0a1')$$,
  '23514', 'Solo una factura de Ventas puede facturar un remito interno.',
  'a remito interno cannot bill another remito');
select throws_ok(
  $$insert into public.invoices
      (channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
       doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, cbte_tipo_afip,
       iva_condition_receptor, status, idempotency_key, source_remito_id)
    values ('jouve_fiscal', '00000000-0000-0000-0000-00000005c0f1', 'factura', 'A', 3, null,
       current_date, 2, 80, '20999999992', 1000, 210, 1210, 1, 1, 'draft', 'ov-src-2',
       '00000000-0000-0000-0000-00000005e0a2')$$,
  '23514', 'El origen tiene que ser un remito interno emitido.',
  'a draft remito cannot be billed');
select throws_ok(
  $$insert into public.invoices
      (channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
       doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, cbte_tipo_afip,
       iva_condition_receptor, status, idempotency_key, source_remito_id)
    values ('jouve_fiscal', '00000000-0000-0000-0000-00000005c0f1', 'factura', 'A', 3, null,
       current_date, 2, 80, '20999999992', 1000, 210, 1210, 1, 1, 'draft', 'ov-src-3',
       '00000000-0000-0000-0000-0000000000ff')$$,
  '23514', null,
  'a missing source remito is refused');

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key, source_remito_id)
values
  ('00000000-0000-0000-0000-00000005e0f1', 'jouve_fiscal', '00000000-0000-0000-0000-00000005c0f1',
   'factura', 'A', 3, null, current_date, 2, 80, '20999999992', 1000, 210, 1210, 1, 1,
   'draft', 'ov-factura', '00000000-0000-0000-0000-00000005e0a1');

select ok(
  (select source_remito_id = '00000000-0000-0000-0000-00000005e0a1'
     from public.invoices where id = '00000000-0000-0000-0000-00000005e0f1'),
  'a fiscal factura bills an emitted remito interno');

select throws_ok(
  $$insert into public.invoices
      (channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
       doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, cbte_tipo_afip,
       iva_condition_receptor, status, idempotency_key, source_remito_id)
    values ('jouve_fiscal', '00000000-0000-0000-0000-00000005c0f1', 'factura', 'A', 3, null,
       current_date, 2, 80, '20999999992', 1000, 210, 1210, 1, 1, 'draft', 'ov-src-4',
       '00000000-0000-0000-0000-00000005e0a1')$$,
  '23505', null,
  'a remito has one live factura');

-- 5. move_billed_remito_receipts ---------------------------------------------

select throws_ok(
  $$select public.move_billed_remito_receipts('00000000-0000-0000-0000-00000005e0f1')$$,
  '23514', 'La factura todavía no está emitida.',
  'nothing moves before the factura is emitted');

update public.invoices set status = 'emitted', numero = 99953
 where id = '00000000-0000-0000-0000-00000005e0f1';

create temp table t_before on commit drop as
select
  (select count(*) from public.transactions t where t.account_id = '00000000-0000-0000-0000-00000005ac01') as tx_rows,
  (select coalesce(sum(t.amount), 0) from public.transactions t
     where t.account_id = '00000000-0000-0000-0000-00000005ac01') as tx_sum;

select is(
  public.move_billed_remito_receipts('00000000-0000-0000-0000-00000005e0f1'),
  1, 'the recibo interno of the remito moves');

select is(
  (select status from public.receipts
    where channel_id = 'jouve_internal' and punto_venta = 9001 and numero = 99952),
  'canceled', 'the recibo interno is cancelled');

select is(
  (select count(*)::int from public.receipts r
     join public.receipt_allocations ra on ra.receipt_id = r.id
    where r.channel_id = 'jouve_fiscal'
      and r.client_id = '00000000-0000-0000-0000-00000005c0f1'
      and r.status = 'issued'
      and r.total_amount = 600
      and ra.invoice_id = '00000000-0000-0000-0000-00000005e0f1'
      and ra.amount_applied = 600),
  1, 'a fiscal recibo of the factura client, for the same 600, pays the factura');

select is(
  (select coalesce(sum(l.amount), 0) from public.receipt_payment_lines l
     join public.receipts r on r.id = l.receipt_id
    where r.channel_id = 'jouve_fiscal' and r.client_id = '00000000-0000-0000-0000-00000005c0f1'
      and l.account_id = '00000000-0000-0000-0000-00000005ac01'),
  600::numeric, 'the fiscal recibo carries the same payment lines');

select is(
  (select coalesce(sum(t.amount), 0) from public.transactions t
     where t.account_id = '00000000-0000-0000-0000-00000005ac01'),
  (select tx_sum from t_before),
  'the cash is counted once: the account balance is unchanged by the move');

select is(
  public.invoice_open_amount('00000000-0000-0000-0000-00000005e0f1'),
  610::numeric, 'the factura owes its total less the moved cobro (1210 - 600)');

select is(
  public.invoice_open_amount('00000000-0000-0000-0000-00000005e0a1'),
  1000::numeric, 'the remito is open for its whole total, ready for the NC');

select is(
  public.move_billed_remito_receipts('00000000-0000-0000-0000-00000005e0f1'),
  0, 'a retry moves nothing');

select is(
  public.move_billed_remito_receipts('00000000-0000-0000-0000-00000005e0a1'),
  0, 'a document with no source remito moves nothing');

-- 6. fiscal_reader sees only fiscal counterparties ---------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000005fa","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.clients where id = '00000000-0000-0000-0000-00000005c0a1'),
  0, 'a fiscal_reader cannot read an internal client');
select is(
  (select count(*)::int from public.clients where id = '00000000-0000-0000-0000-00000005c0f1'),
  1, 'a fiscal_reader reads a fiscal client');
select is(
  (select count(*)::int from public.suppliers where not is_fiscal),
  0, 'a fiscal_reader reads no internal supplier');
select is(
  (select count(*)::int from public.search_clients('Otras ventas OV', false, 0, 50, false)),
  0, 'search_clients(p_is_fiscal => false) returns nothing to a fiscal_reader');

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- 7. Function ACLs ------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.move_billed_remito_receipts(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.move_billed_remito_receipts(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.move_billed_remito_receipts(uuid)', 'execute'),
  'move_billed_remito_receipts runs for the service role alone');

select ok(
  not has_function_privilege('authenticated', 'public.guard_document_side()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_invoice_source_remito()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_counterparty_side_immutable()', 'execute')
  and not has_function_privilege('anon', 'public.guard_document_side()', 'execute'),
  'the new guard functions are not callable through the API');

select ok(
  not has_function_privilege('anon', 'public.search_clients(text, boolean, int, int, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.search_clients(text, boolean, int, int, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.search_suppliers(text, boolean, int, int, uuid, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.search_suppliers(text, boolean, int, int, uuid, boolean)', 'execute'),
  'the side-aware searches are callable by authenticated users only');

select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('move_billed_remito_receipts', 'guard_document_side',
                        'guard_invoice_source_remito')
      and p.prosecdef
      and p.proconfig @> array['search_path=""']),
  3, 'every new SECURITY DEFINER pins an empty search_path');

select * from finish();
rollback;
