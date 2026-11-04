-- Roadmap 1.0 prerequisites (20261102250000): journal_document_entry builds
-- the entry of a document on any channel, journal_expected_entry still gives
-- exactly what it gave (the fiscal entry, nothing for internal channels), and
-- invoice_items.revenue_kind is a management marker editable after emission.
-- One transaction, rolled back.

begin;

select plan(11);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000014c0f1', true, '20999999914', 'Cliente Documento', 'responsable_inscripto'),
  ('00000000-0000-0000-0000-00000014c0a1', false, null, 'Cliente Documento Interno', null);
insert into public.suppliers (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000014d0f1', true, '30999999914', 'Proveedor Documento', 'responsable_inscripto'),
  ('00000000-0000-0000-0000-00000014d0a1', false, null, 'Proveedor Documento Interno', null);
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000014ac01', 'Banco Documento', 'bank', 'ARS');

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000014e0f1', 'jouve_fiscal', '00000000-0000-0000-0000-00000014c0f1',
   'factura', 'A', 3, 98141, current_date, 2, 80, '20999999914', 100, 21, 121, 1, 1, 'emitted', 'doc-entry-f');
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000014e0a1', 'jouve_internal', '00000000-0000-0000-0000-00000014c0a1',
   'factura', null, 9001, 98141, current_date, 2, 99, '0', 300, 0, 300, 'emitted', 'doc-entry-i');
insert into public.invoice_items
  (id, invoice_id, description, quantity, unit_price, iva_rate_id, line_neto, line_iva, line_total)
values
  ('00000000-0000-0000-0000-00000014f0f1', '00000000-0000-0000-0000-00000014e0f1',
   'Flete', 1, 100, 5, 100, 21, 121);

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, imp_neto, imp_iva, imp_total, status)
values
  ('00000000-0000-0000-0000-00000014b0f1', 'jouve_fiscal', '00000000-0000-0000-0000-00000014d0f1',
   'factura', 'A', 1, 98141, current_date, 200, 42, 242, 'received'),
  ('00000000-0000-0000-0000-00000014b0a1', 'jouve_internal', '00000000-0000-0000-0000-00000014d0a1',
   'factura', null, 1, 98142, current_date, 50, 0, 50, 'received');

insert into public.receipts (id, channel_id, punto_venta, numero, client_id, receipt_date, total_amount, currency)
values
  ('00000000-0000-0000-0000-00000014a0f1', 'jouve_fiscal', 3, 98141,
   '00000000-0000-0000-0000-00000014c0f1', current_date, 121, 'ARS');
-- The receipt was inserted by hand above, so its lines are too: only
-- create_receipt / update_receipt write them (guard_document_line).
alter table public.receipt_payment_lines disable trigger receipt_payment_lines_guard_rpc;
insert into public.receipt_payment_lines (receipt_id, account_id, amount) values
  ('00000000-0000-0000-0000-00000014a0f1', '00000000-0000-0000-0000-00000014ac01', 121);
alter table public.receipt_payment_lines enable trigger receipt_payment_lines_guard_rpc;

insert into public.payment_orders (id, channel_id, punto_venta, numero, supplier_id, payment_date, total_amount, currency)
values
  ('00000000-0000-0000-0000-0000000140f1', 'jouve_fiscal', 3, 98141,
   '00000000-0000-0000-0000-00000014d0f1', current_date, 242, 'ARS');
-- The payment order was inserted by hand above, so its lines are too: only
-- create_payment_order / update_payment_order write them (guard_document_line).
alter table public.payment_order_payment_lines disable trigger payment_order_payment_lines_guard_rpc;
insert into public.payment_order_payment_lines (payment_order_id, account_id, amount) values
  ('00000000-0000-0000-0000-0000000140f1', '00000000-0000-0000-0000-00000014ac01', 242);
alter table public.payment_order_payment_lines enable trigger payment_order_payment_lines_guard_rpc;

insert into public.transactions
  (id, account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description)
values
  ('00000000-0000-0000-0000-0000000141f1', '00000000-0000-0000-0000-00000014ac01', 'jouve_fiscal',
   'expense', 70, 'ARS', current_date, date_trunc('month', current_date)::date, 'Gasto fiscal'),
  ('00000000-0000-0000-0000-0000000141a1', '00000000-0000-0000-0000-00000014ac01', 'jouve_internal',
   'expense', 30, 'ARS', current_date, date_trunc('month', current_date)::date, 'Gasto interno');

set constraints all immediate;

create temp table docs (src text, id uuid, fiscal boolean);
insert into docs values
  ('invoices',          '00000000-0000-0000-0000-00000014e0f1', true),
  ('purchase_invoices', '00000000-0000-0000-0000-00000014b0f1', true),
  ('receipts',          '00000000-0000-0000-0000-00000014a0f1', true),
  ('payment_orders',    '00000000-0000-0000-0000-0000000140f1', true),
  ('transactions',      '00000000-0000-0000-0000-0000000141f1', true),
  ('invoices',          '00000000-0000-0000-0000-00000014e0a1', false),
  ('purchase_invoices', '00000000-0000-0000-0000-00000014b0a1', false),
  ('transactions',      '00000000-0000-0000-0000-0000000141a1', false);

select is(
  (select count(*)::int from docs
    where fiscal
      and jsonb_typeof(public.journal_document_entry(src, id) -> 'lines') = 'array'
      and public.journal_document_entry(src, id) = public.journal_expected_entry(src, id)),
  5,
  'a fiscal document: journal_document_entry equals journal_expected_entry, origin by origin'
);

select is(
  (select count(*)::int from docs
    where fiscal and public.journal_entry_status(src, id) = 'match'),
  5,
  'and the entry the journal posted is that one'
);

-- Every live fiscal document in the database, seeds included.
select is(
  (select count(*)::int from (
     select 'invoices' as src, i.id from public.invoices i where i.status = 'emitted' and public.is_channel_fiscal(i.channel_id)
     union all
     select 'purchase_invoices', p.id from public.purchase_invoices p where p.status = 'received' and public.is_channel_fiscal(p.channel_id)
     union all
     select 'receipts', r.id from public.receipts r where r.status = 'issued' and public.is_channel_fiscal(r.channel_id)
     union all
     select 'payment_orders', po.id from public.payment_orders po where po.status = 'issued' and public.is_channel_fiscal(po.channel_id)
     union all
     select 'transactions', t.id from public.transactions t where public.is_channel_fiscal(t.channel_id)
   ) d
   where public.journal_document_entry(d.src, d.id) is distinct from public.journal_expected_entry(d.src, d.id)),
  0,
  'no live fiscal document differs between the two'
);

select is(
  (select count(*)::int from docs
    where not fiscal and public.journal_expected_entry(src, id) -> 'lines' = 'null'::jsonb),
  3,
  'an internal document still expects no fiscal entry'
);

select is(
  (select count(*)::int from docs
    where not fiscal and jsonb_typeof(public.journal_document_entry(src, id) -> 'lines') = 'array'),
  3,
  'but journal_document_entry builds its lines'
);

select is(
  (select count(*)::int from public.journal_entries je
     join docs d on d.id = je.source_id and d.src = je.source_table
    where not d.fiscal),
  0,
  'and nothing is posted for it'
);

select is(
  (select (public.journal_document_entry('invoices', '00000000-0000-0000-0000-00000014e0a1') -> 'lines'
           -> 1 ->> 'credit')::numeric),
  300::numeric,
  'a remito interno builds its sale (credit ventas) like a fiscal one'
);

select throws_ok(
  $$select public.journal_document_entry('nope', '00000000-0000-0000-0000-00000014e0a1')$$,
  '22023',
  null,
  'an unknown origin is refused'
);

-- revenue_kind --------------------------------------------------------------------

select is(
  (select revenue_kind from public.invoice_items where id = '00000000-0000-0000-0000-00000014f0f1'),
  'service',
  'an item is a service by default'
);

select lives_ok(
  $$update public.invoice_items set revenue_kind = 'asset_sale'
     where id = '00000000-0000-0000-0000-00000014f0f1'$$,
  'an emitted comprobante''s item can be marked as an asset sale'
);

select throws_ok(
  $$update public.invoice_items set revenue_kind = 'service', description = 'Otra cosa'
     where id = '00000000-0000-0000-0000-00000014f0f1'$$,
  '55006',
  null,
  'anything else on it stays frozen'
);

select * from finish();
rollback;
