-- Otras ventas / Otras compras (docs/otras-ventas.md): counterparty sides,
-- guard_document_side, guard_invoice_source_remito, the one-live-factura index,
-- settle_billed_remito and what blocks it, the frozen remito, fiscal_reader on clients/suppliers and the ACLs
-- of the new functions. One transaction, rolled back.

begin;

select plan(72);

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

-- While a live factura bills the remito, the remito is frozen.
select throws_ok(
  $$select public.create_receipt('jouve_internal', 9001, 99953, '00000000-0000-0000-0000-00000005c0a1',
      current_date, 100, 'ARS', 'otro cobro',
      '[{"account_id":"00000000-0000-0000-0000-00000005ac01","amount":100}]'::jsonb,
      '[{"invoice_id":"00000000-0000-0000-0000-00000005e0a1","amount_applied":100}]'::jsonb,
      '[]'::jsonb)$$,
  '23514', 'El remito se facturó en Ventas: no admite cobros, ajustes, notas de crédito ni anulación.',
  'a remito being billed takes no new cobro');
select throws_ok(
  $$update public.invoices set status = 'cancelled' where id = '00000000-0000-0000-0000-00000005e0a1'$$,
  '23514', 'El remito se facturó en Ventas: no admite cobros, ajustes, notas de crédito ni anulación.',
  'a remito being billed cannot be anulado');
select throws_ok(
  $$insert into public.invoices
      (channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
       doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
    values ('jouve_internal', '00000000-0000-0000-0000-00000005c0a1', 'nc', null, 9001, null,
       current_date, 2, 99, '0', 100, 0, 100, 'draft', 'ov-user-nc',
       '00000000-0000-0000-0000-00000005e0a1')$$,
  '23514', 'El remito se facturó en Ventas: no admite cobros, ajustes, notas de crédito ni anulación.',
  'a remito being billed takes no NC but its settlement''s');

-- What blocks billing is checked on the factura's insert, whoever drafts it.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000005e0b1', 'jouve_internal', '00000000-0000-0000-0000-00000005c0a1',
   'factura', null, 9001, 99954, current_date, 2, 99, '0', 300, 0, 300, 'emitted', 'ov-remito-b', null),
  ('00000000-0000-0000-0000-00000005e0b2', 'jouve_internal', '00000000-0000-0000-0000-00000005c0a1',
   'nc', null, 9001, 99955, current_date, 2, 99, '0', 100, 0, 100, 'emitted', 'ov-remito-b-nc',
   '00000000-0000-0000-0000-00000005e0b1');
select throws_ok(
  $$insert into public.invoices
      (channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
       doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, cbte_tipo_afip,
       iva_condition_receptor, status, idempotency_key, source_remito_id)
    values ('jouve_fiscal', '00000000-0000-0000-0000-00000005c0f1', 'factura', 'A', 3, null,
       current_date, 2, 80, '20999999992', 300, 63, 363, 1, 1, 'draft', 'ov-src-5',
       '00000000-0000-0000-0000-00000005e0b1')$$,
  '23514', 'El remito ya tiene una nota de crédito: no se puede facturar.',
  'a remito with an NC cannot be billed, even outside billRemitoAction');

-- 5. settle_billed_remito ----------------------------------------------------

select throws_ok(
  $$select public.settle_billed_remito('00000000-0000-0000-0000-00000005e0f1')$$,
  '23514', 'La factura todavía no está emitida.',
  'nothing settles before the factura is emitted');

update public.invoices set status = 'emitted', numero = 99953
 where id = '00000000-0000-0000-0000-00000005e0f1';

create temp table t_before on commit drop as
select
  (select coalesce(sum(t.amount), 0) from public.transactions t
     where t.account_id = '00000000-0000-0000-0000-00000005ac01') as tx_sum;

create temp table t_nc on commit drop as
select public.settle_billed_remito('00000000-0000-0000-0000-00000005e0f1') as nc_id;

select isnt((select nc_id from t_nc), null, 'settling drafts the remito''s NC');

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

select ok(
  (select n.kind = 'nc' and n.status = 'draft' and n.imp_total = 1000
          and n.invoice_origin_id = '00000000-0000-0000-0000-00000005e0a1'
          and n.channel_id = 'jouve_internal'
     from public.invoices n where n.id = (select nc_id from t_nc)),
  'the NC credits the remito''s open 1000 on the internal side');

select is(
  public.invoice_open_amount('00000000-0000-0000-0000-00000005e0a1'),
  0::numeric, 'the remito is left with nothing open');

select is(
  public.settle_billed_remito('00000000-0000-0000-0000-00000005e0f1'),
  (select nc_id from t_nc), 'a retry returns the NC it already drafted');

select is(
  public.settle_billed_remito('00000000-0000-0000-0000-00000005e0a1'),
  null::uuid, 'a document with no source remito settles nothing');

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
  not has_function_privilege('authenticated', 'public.settle_billed_remito(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.settle_billed_remito(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.settle_billed_remito(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.billed_remito_blocker(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.billed_remito_blocker(uuid)', 'execute'),
  'settle_billed_remito and billed_remito_blocker run for the service role alone');

select ok(
  not has_function_privilege('authenticated', 'public.guard_document_side()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_invoice_source_remito()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_counterparty_side_immutable()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_billed_remito_frozen()', 'execute')
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
      and p.proname in ('settle_billed_remito', 'billed_remito_blocker',
                        'guard_billed_remito_frozen', 'guard_document_side',
                        'guard_invoice_source_remito')
      and p.prosecdef
      and p.proconfig @> array['search_path=""']),
  5, 'every new SECURITY DEFINER pins an empty search_path');


-- 8. billed_remito_blocker cases, the freeze and the settlement edges --------

-- Remitos 1..9 of the internal client; one recibo interno per case.
insert into public.clients (id, is_fiscal, legal_name) values
  ('00000000-0000-0000-0000-00000005c0a2', false, 'Cliente Otras ventas OV saldo');
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key)
select ('00000000-0000-0000-0000-0000000570' || lpad(n::text, 2, '0'))::uuid,
       'jouve_internal',
       case when n = 1 then '00000000-0000-0000-0000-00000005c0a2'::uuid
            else '00000000-0000-0000-0000-00000005c0a1'::uuid end,
       'factura', null, 9001, 99960 + n, current_date, 2, 99, '0',
       500, 0, 500, 'emitted', 'ov-blk-' || n
from generate_series(1, 9) n;

-- A factura of Ventas for remito n, as billRemitoAction drafts it.
create function pg_temp.draft_factura(p_n int) returns uuid language sql as $f$
  insert into public.invoices
    (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
     doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, cbte_tipo_afip,
     iva_condition_receptor, status, idempotency_key, source_remito_id)
  values (('00000000-0000-0000-0000-0000000571' || lpad(p_n::text, 2, '0'))::uuid,
     'jouve_fiscal', '00000000-0000-0000-0000-00000005c0f1', 'factura', 'A', 3, null,
     current_date, 2, 80, '20999999992', 500, 105, 605, 1, 1, 'draft',
     'ov-blk-factura-' || p_n,
     ('00000000-0000-0000-0000-0000000570' || lpad(p_n::text, 2, '0'))::uuid)
  returning id;
$f$;

-- 8a. Opening-balance (ajuste de saldo) allocation.
insert into public.client_opening_balances (client_id, opening_date, target_balance, total_settled)
values ('00000000-0000-0000-0000-00000005c0a2', current_date, 100, 100);
insert into public.client_opening_balance_allocations (client_id, invoice_id, amount_applied)
values ('00000000-0000-0000-0000-00000005c0a2', '00000000-0000-0000-0000-000000057001', 100);
select is(
  public.billed_remito_blocker('00000000-0000-0000-0000-000000057001'),
  'El remito está saldado en parte por un ajuste de saldo: quitá el ajuste antes de facturarlo.',
  'an ajuste de saldo applied to the remito blocks billing');
select throws_ok(
  $$select pg_temp.draft_factura(1)$$,
  '23514', 'El remito está saldado en parte por un ajuste de saldo: quitá el ajuste antes de facturarlo.',
  'the factura insert refuses a remito with an ajuste de saldo');

-- 8b. A recibo with retentions.
select public.create_receipt('jouve_internal', 9001, 99961, '00000000-0000-0000-0000-00000005c0a1',
  current_date, 500, 'ARS', 'recibo con retención',
  '[{"account_id":"00000000-0000-0000-0000-00000005ac01","amount":400}]'::jsonb,
  '[{"invoice_id":"00000000-0000-0000-0000-000000057002","amount_applied":500}]'::jsonb,
  '[{"kind":"retencion","tax_type":"iibb","certificate_number":"OV-1","certificate_date":"2026-11-01","amount":100}]'::jsonb);
select throws_ok(
  $$select pg_temp.draft_factura(2)$$,
  '23514', 'El cobro del remito tiene retenciones: anulá ese recibo interno, facturá el remito y cargá el cobro en Ventas.',
  'the factura insert refuses a remito collected with retentions');

-- 8c. A recibo whose cobro came in a cheque.
create temp table t_r3 on commit drop as
select public.create_receipt('jouve_internal', 9001, 99962, '00000000-0000-0000-0000-00000005c0a1',
  current_date, 200, 'ARS', 'recibo con cheque',
  '[{"account_id":"00000000-0000-0000-0000-00000005ac01","amount":200}]'::jsonb,
  '[{"invoice_id":"00000000-0000-0000-0000-000000057003","amount_applied":200}]'::jsonb,
  '[]'::jsonb) as id;
insert into public.checks
  (kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
   source_kind, source_receipt_id, cartera_account_id)
select 'fisico', 'OV-CHQ-1', 'Banco OV', 'Librador OV', current_date, current_date + 30, 200, 'ARS',
       'receipt', id, '00000000-0000-0000-0000-00000005ac01'
from t_r3;
select throws_ok(
  $$select pg_temp.draft_factura(3)$$,
  '23514', 'El remito se cobró con cheques: anulá ese recibo interno, facturá el remito y cargá el cobro en Ventas.',
  'the factura insert refuses a remito collected with a cheque');

-- 8d. A recibo that also pays another remito.
select public.create_receipt('jouve_internal', 9001, 99963, '00000000-0000-0000-0000-00000005c0a1',
  current_date, 400, 'ARS', 'recibo de dos remitos',
  '[{"account_id":"00000000-0000-0000-0000-00000005ac01","amount":400}]'::jsonb,
  '[{"invoice_id":"00000000-0000-0000-0000-000000057004","amount_applied":300},
    {"invoice_id":"00000000-0000-0000-0000-000000057009","amount_applied":100}]'::jsonb,
  '[]'::jsonb);
select throws_ok(
  $$select pg_temp.draft_factura(4)$$,
  '23514', 'Un recibo interno de este remito también paga otros comprobantes: anulalo, facturá el remito y cargá el cobro en Ventas.',
  'the factura insert refuses a remito whose recibo also pays another document');

-- 8e. A recibo in a closed accounting period.
select public.create_receipt('jouve_internal', 9001, 99964, '00000000-0000-0000-0000-00000005c0a1',
  '2001-01-10', 200, 'ARS', 'recibo de un período cerrado',
  '[{"account_id":"00000000-0000-0000-0000-00000005ac01","amount":200}]'::jsonb,
  '[{"invoice_id":"00000000-0000-0000-0000-000000057005","amount_applied":200}]'::jsonb,
  '[]'::jsonb);
insert into public.accounting_closed_periods (period) values ('2001-01');
select throws_ok(
  $$select pg_temp.draft_factura(5)$$,
  '23514', 'El remito se cobró en un período contable cerrado: no se puede pasar el cobro a Ventas.',
  'the factura insert refuses a remito collected in a closed period');

-- 8f. Once drafted, nothing can add a blocker through update_receipt or an
-- ajuste: re-applying the recibo to the frozen remito is refused.
create temp table t_r6 on commit drop as
select public.create_receipt('jouve_internal', 9001, 99965, '00000000-0000-0000-0000-00000005c0a1',
  '2001-02-10', 200, 'ARS', 'recibo del remito 6',
  '[{"account_id":"00000000-0000-0000-0000-00000005ac01","amount":200}]'::jsonb,
  '[{"invoice_id":"00000000-0000-0000-0000-000000057006","amount_applied":200}]'::jsonb,
  '[]'::jsonb) as id;
select lives_ok($$select pg_temp.draft_factura(6)$$, 'a remito with a plain cash cobro is drafted');
select throws_ok(
  format($$select public.update_receipt(%L, '2001-02-10', 200, 'retención agregada',
      '[{"account_id":"00000000-0000-0000-0000-00000005ac01","amount":150}]'::jsonb,
      '[{"invoice_id":"00000000-0000-0000-0000-000000057006","amount_applied":200}]'::jsonb,
      '[{"kind":"retencion","tax_type":"iibb","certificate_number":"OV-2","certificate_date":"2026-11-01","amount":50}]'::jsonb,
      null)$$, (select id from t_r6)),
  '23514', 'El remito se facturó en Ventas: no admite cobros, ajustes, notas de crédito ni anulación.',
  'a frozen remito''s recibo cannot gain a retention through update_receipt');
select throws_ok(
  format($$select public.update_receipt(%L, '2001-02-10', 300, 'otro comprobante agregado',
      '[{"account_id":"00000000-0000-0000-0000-00000005ac01","amount":300}]'::jsonb,
      '[{"invoice_id":"00000000-0000-0000-0000-000000057006","amount_applied":200},
        {"invoice_id":"00000000-0000-0000-0000-000000057009","amount_applied":100}]'::jsonb,
      '[]'::jsonb, null)$$, (select id from t_r6)),
  '23514', 'El remito se facturó en Ventas: no admite cobros, ajustes, notas de crédito ni anulación.',
  'a frozen remito''s recibo cannot start paying another document through update_receipt');
insert into public.client_opening_balances (client_id, opening_date, target_balance, total_settled)
values ('00000000-0000-0000-0000-00000005c0a1', current_date, 100, 100);
select throws_ok(
  $$insert into public.client_opening_balance_allocations (client_id, invoice_id, amount_applied)
    values ('00000000-0000-0000-0000-00000005c0a1', '00000000-0000-0000-0000-000000057006', 50)$$,
  '23514', 'El remito se facturó en Ventas: no admite cobros, ajustes, notas de crédito ni anulación.',
  'a frozen remito takes no ajuste de saldo');

-- A period closed after the factura was drafted is caught when settling.
update public.invoices set status = 'emitted', numero = 99966
 where id = '00000000-0000-0000-0000-000000057106';
insert into public.accounting_closed_periods (period) values ('2001-02');
select throws_ok(
  $$select public.settle_billed_remito('00000000-0000-0000-0000-000000057106')$$,
  '23514', 'El remito se cobró en un período contable cerrado: no se puede pasar el cobro a Ventas.',
  'settling re-checks the blocker: a period closed after drafting refuses the move');
select is(
  (select status from public.receipts where id = (select id from t_r6)),
  'issued', 'a refused settlement leaves the recibo interno in place');

-- A retention written straight to the table (no app path) is caught too.
delete from public.accounting_closed_periods where period = '2001-02';
insert into public.receipt_retentions (receipt_id, kind, tax_type, certificate_number, certificate_date, amount)
select id, 'retencion', 'iibb', 'OV-3', current_date, 10 from t_r6;
select throws_ok(
  $$select public.settle_billed_remito('00000000-0000-0000-0000-000000057106')$$,
  '23514', 'El cobro del remito tiene retenciones: anulá ese recibo interno, facturá el remito y cargá el cobro en Ventas.',
  'settling re-checks the blocker: a retention added after drafting refuses the move');

-- 8g. A factura AFIP rejected (failed) releases the remito.
select lives_ok($$select pg_temp.draft_factura(7)$$, 'remito 7 is drafted on a factura');
update public.invoices set status = 'failed' where id = '00000000-0000-0000-0000-000000057107';
select lives_ok(
  $$select public.create_receipt('jouve_internal', 9001, 99967, '00000000-0000-0000-0000-00000005c0a1',
      current_date, 100, 'ARS', 'cobro tras el rechazo',
      '[{"account_id":"00000000-0000-0000-0000-00000005ac01","amount":100}]'::jsonb,
      '[{"invoice_id":"00000000-0000-0000-0000-000000057007","amount_applied":100}]'::jsonb,
      '[]'::jsonb)$$,
  'a remito whose factura failed takes a cobro again');
select lives_ok(
  $$insert into public.invoices
      (channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
       doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, cbte_tipo_afip,
       iva_condition_receptor, status, idempotency_key, source_remito_id)
    values ('jouve_fiscal', '00000000-0000-0000-0000-00000005c0f1', 'factura', 'A', 3, null,
       current_date, 2, 80, '20999999992', 500, 105, 605, 1, 1, 'draft', 'ov-blk-factura-7b',
       '00000000-0000-0000-0000-000000057007')$$,
  'a remito whose factura failed can be billed again');
select throws_ok(
  $$select public.settle_billed_remito('00000000-0000-0000-0000-000000057107')$$,
  '23514', 'La factura todavía no está emitida.',
  'a factura AFIP rejected never settles its remito');

-- 8h. A remito fully collected: its recibo moves whole, so the remito is left
-- with all of its total open and the NC credits all of it.
select public.create_receipt('jouve_internal', 9001, 99968, '00000000-0000-0000-0000-00000005c0a1',
  current_date, 500, 'ARS', 'recibo total del remito 8',
  '[{"account_id":"00000000-0000-0000-0000-00000005ac01","amount":500}]'::jsonb,
  '[{"invoice_id":"00000000-0000-0000-0000-000000057008","amount_applied":500}]'::jsonb,
  '[]'::jsonb);
select pg_temp.draft_factura(8);
update public.invoices set status = 'emitted', numero = 99968
 where id = '00000000-0000-0000-0000-000000057108';
create temp table t_nc8 on commit drop as
select public.settle_billed_remito('00000000-0000-0000-0000-000000057108') as nc_id;
select ok(
  (select n.kind = 'nc' and n.imp_total = 500
          and n.invoice_origin_id = '00000000-0000-0000-0000-000000057008'
     from public.invoices n where n.id = (select nc_id from t_nc8)),
  'a fully collected remito is credited in full once its recibo moved');
select is(
  public.invoice_open_amount('00000000-0000-0000-0000-000000057108'),
  105::numeric, 'the moved recibo pays the factura (605 - 500)');
select is(
  public.invoice_open_amount('00000000-0000-0000-0000-000000057008'),
  0::numeric, 'the remito is left with nothing open');
select is(
  public.settle_billed_remito('00000000-0000-0000-0000-000000057108'),
  (select nc_id from t_nc8), 'a rerun on a settled remito returns the same NC');
select is(
  (select count(*)::int from public.invoices
    where kind = 'nc' and invoice_origin_id = '00000000-0000-0000-0000-000000057008'),
  1, 'the rerun drafts no second NC');
select is(
  (select count(*)::int from public.receipts r
     join public.receipt_allocations ra on ra.receipt_id = r.id
    where ra.invoice_id = '00000000-0000-0000-0000-000000057108' and r.status = 'issued'),
  1, 'the rerun does not move the recibo twice');

select * from finish();
rollback;
