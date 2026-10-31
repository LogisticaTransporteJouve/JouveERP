-- One reversal by clone and one re-post by comparison (20261031180534):
-- inserts still post, cancelling clones the original entry negated (accounts
-- and cost center as booked), edits re-post once and only when the entry
-- changes, a closed period rejects only what changes the entry or the Libro
-- IVA Compras, and purchases keep their open amount, channel, kind and fiscal
-- letter. Deferred triggers run at `set constraints all immediate`. One
-- transaction, rolled back.

begin;

select plan(44);

create function pg_temp.live_entries(p_source text, p_id uuid) returns int
language sql as $$
  select count(*)::int from public.journal_entries je
   where je.source_table = p_source and je.source_id = p_id and not je.is_reversal
     and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = je.id);
$$;

create function pg_temp.role_amount(p_entry uuid, p_role text, p_side text) returns numeric
language sql as $$
  select coalesce(sum(case when p_side = 'debit' then l.debit else l.credit end), 0)
    from public.journal_entry_lines l
    join public.chart_of_accounts c on c.id = l.chart_of_accounts_id
   where l.journal_entry_id = p_entry and c.system_role::text = p_role;
$$;

create function pg_temp.live_entry(p_source text, p_id uuid) returns uuid
language sql as $$
  select je.id from public.journal_entries je
   where je.source_table = p_source and je.source_id = p_id and not je.is_reversal
     and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = je.id)
   order by je.created_at desc limit 1;
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000009f1', 'finance@journal-reverse.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000009f1', 'finance');

insert into public.clients (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000c901', '20999999992', 'Cliente Reverso', 'responsable_inscripto');
insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000b901', '30999999993', 'Proveedor Reverso', 'responsable_inscripto');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000a901', 'Banco Reverso', 'bank', 'ARS'),
  ('00000000-0000-0000-0000-00000000a902', 'Banco que pasa a caja', 'bank', 'ARS');
insert into public.cost_centers (id, code, name) values
  ('00000000-0000-0000-0000-0000000009cc', 'CC-REV', 'Centro reverso');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000009f1","role":"authenticated"}', true);

-- Invoices are written by SECURITY DEFINER paths only.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key)
values
  ('00000000-0000-0000-0000-0000000009e1', 'jouve_fiscal', '00000000-0000-0000-0000-00000000c901',
   'factura', 'A', 3, 99001, current_date, 2, 80, '20999999992', 100, 21, 121, 1, 1, 'emitted', 'journal-reverse-e1');

set local role authenticated;

-- Inserts of every origin still post ------------------------------------------

insert into public.receipts (id, channel_id, punto_venta, numero, client_id, receipt_date, total_amount, currency)
values
  ('00000000-0000-0000-0000-0000000009b1', 'jouve_fiscal', 3, 99001, '00000000-0000-0000-0000-00000000c901', current_date, 1000, 'ARS'),
  ('00000000-0000-0000-0000-0000000009b2', 'jouve_fiscal', 3, 99002, '00000000-0000-0000-0000-00000000c901', '1999-01-15', 500, 'ARS'),
  ('00000000-0000-0000-0000-0000000009b3', 'jouve_fiscal', 3, 99003, '00000000-0000-0000-0000-00000000c901', current_date, 300, 'ARS'),
  ('00000000-0000-0000-0000-0000000009b4', 'jouve_fiscal', 3, 99004, '00000000-0000-0000-0000-00000000c901', current_date, 400, 'ARS'),
  ('00000000-0000-0000-0000-0000000009b5', 'jouve_fiscal', 3, 99005, '00000000-0000-0000-0000-00000000c901', current_date, 600, 'ARS'),
  ('00000000-0000-0000-0000-0000000009b6', 'jouve_fiscal', 3, 99006, '00000000-0000-0000-0000-00000000c901', '1999-01-16', 700, 'ARS');
insert into public.receipt_payment_lines (receipt_id, account_id, amount) values
  ('00000000-0000-0000-0000-0000000009b1', '00000000-0000-0000-0000-00000000a901', 1000),
  ('00000000-0000-0000-0000-0000000009b2', '00000000-0000-0000-0000-00000000a901', 500),
  ('00000000-0000-0000-0000-0000000009b3', '00000000-0000-0000-0000-00000000a901', 300),
  ('00000000-0000-0000-0000-0000000009b4', '00000000-0000-0000-0000-00000000a902', 400),
  ('00000000-0000-0000-0000-0000000009b5', '00000000-0000-0000-0000-00000000a901', 600),
  ('00000000-0000-0000-0000-0000000009b6', '00000000-0000-0000-0000-00000000a901', 700);

insert into public.payment_orders (id, channel_id, punto_venta, numero, supplier_id, payment_date, total_amount, currency)
values
  ('00000000-0000-0000-0000-0000000009c1', 'jouve_fiscal', 3, 99001, '00000000-0000-0000-0000-00000000b901', current_date, 800, 'ARS'),
  ('00000000-0000-0000-0000-0000000009c2', 'jouve_fiscal', 3, 99002, '00000000-0000-0000-0000-00000000b901', current_date, 100, 'ARS');
insert into public.payment_order_payment_lines (payment_order_id, account_id, amount) values
  ('00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-00000000a901', 800),
  ('00000000-0000-0000-0000-0000000009c2', '00000000-0000-0000-0000-00000000a901', 100);

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, imp_neto, imp_iva, imp_total, status)
values
  ('00000000-0000-0000-0000-0000000009d1', 'jouve_fiscal', '00000000-0000-0000-0000-00000000b901',
   'factura', 'A', 7, 99001, current_date, 100, 21, 121, 'received'),
  ('00000000-0000-0000-0000-0000000009d2', 'jouve_fiscal', '00000000-0000-0000-0000-00000000b901',
   'factura', 'A', 7, 99002, '1999-01-20', 100, 21, 121, 'received'),
  ('00000000-0000-0000-0000-0000000009d3', 'jouve_fiscal', '00000000-0000-0000-0000-00000000b901',
   'factura', 'A', 7, 99003, current_date, 100, 0, 100, 'received');

insert into public.payment_order_allocations (payment_order_id, purchase_invoice_id, amount_applied) values
  ('00000000-0000-0000-0000-0000000009c2', '00000000-0000-0000-0000-0000000009d3', 100);

select lives_ok('set constraints all immediate', 'every origin posts at commit');

select is(pg_temp.live_entries('invoices', '00000000-0000-0000-0000-0000000009e1'), 1, 'a fiscal invoice posts');
select is(pg_temp.live_entries('receipts', '00000000-0000-0000-0000-0000000009b1'), 1, 'a fiscal receipt posts');
select is(pg_temp.live_entries('payment_orders', '00000000-0000-0000-0000-0000000009c1'), 1, 'a fiscal payment order posts');
select is(pg_temp.live_entries('purchase_invoices', '00000000-0000-0000-0000-0000000009d1'), 1, 'a fiscal purchase posts');

-- Receipts: edits re-post once ------------------------------------------------

select lives_ok(
  $$set constraints all deferred;
    select public.update_receipt('00000000-0000-0000-0000-0000000009b1', current_date, 1200, null,
      '[{"account_id":"00000000-0000-0000-0000-00000000a901","amount":1200}]'::jsonb, '[]'::jsonb, '[]'::jsonb);
    set constraints all immediate$$,
  'editing a fiscal receipt''s total re-posts'
);
select is(
  (select count(*)::int from public.journal_entries where source_table = 'receipts'
      and source_id = '00000000-0000-0000-0000-0000000009b1'),
  1,
  'the old entry is replaced, not stacked'
);
select is(
  pg_temp.role_amount(pg_temp.live_entry('receipts', '00000000-0000-0000-0000-0000000009b1'), 'clientes', 'credit'),
  1200::numeric,
  'the new entry credits the client the new total'
);

create temp table r1_entry as
  select pg_temp.live_entry('receipts', '00000000-0000-0000-0000-0000000009b1') as id;

update public.receipts set notified_at = now() where id = '00000000-0000-0000-0000-0000000009b1';
set constraints all immediate;
select is(
  pg_temp.live_entry('receipts', '00000000-0000-0000-0000-0000000009b1'),
  (select id from r1_entry),
  'an UPDATE of notified_at never re-posts'
);

select lives_ok(
  $$set constraints all deferred;
    select public.update_receipt('00000000-0000-0000-0000-0000000009b1', current_date, 1200, 'solo notas',
      '[{"account_id":"00000000-0000-0000-0000-00000000a901","amount":1200}]'::jsonb, '[]'::jsonb, '[]'::jsonb);
    set constraints all immediate$$,
  'an edit that leaves the entry equal goes through'
);
select is(
  pg_temp.live_entry('receipts', '00000000-0000-0000-0000-0000000009b1'),
  (select id from r1_entry),
  'and keeps the same entry'
);

-- A receipt whose entry is gone (old data): no entry appears on any update.
reset role;
delete from public.journal_entries where source_id = '00000000-0000-0000-0000-0000000009b3';
set local role authenticated;
update public.receipts set notified_at = now() where id = '00000000-0000-0000-0000-0000000009b3';
select lives_ok(
  $$set constraints all deferred;
    select public.update_receipt('00000000-0000-0000-0000-0000000009b3', current_date, 350, null,
      '[{"account_id":"00000000-0000-0000-0000-00000000a901","amount":350}]'::jsonb, '[]'::jsonb, '[]'::jsonb);
    set constraints all immediate$$,
  'an old receipt without entry can be edited'
);
select is(
  pg_temp.live_entries('receipts', '00000000-0000-0000-0000-0000000009b3'), 0,
  'and still has no entry (journal_missing_entries lists it)'
);
reset role;
select ok(
  exists (select 1 from public.journal_missing_entries()
           where source_id = '00000000-0000-0000-0000-0000000009b3' and status = 'missing'),
  'journal_missing_entries lists the receipt without entry'
);
set local role authenticated;

-- Reversal = the original entry negated ---------------------------------------

-- The account behind R4 changes type (banco → caja) after posting.
reset role;
update public.accounts set type = 'cash' where id = '00000000-0000-0000-0000-00000000a902';
set local role authenticated;
update public.receipts set status = 'canceled', canceled_at = now()
 where id = '00000000-0000-0000-0000-0000000009b4';
select is(
  pg_temp.role_amount(
    (select id from public.journal_entries where source_id = '00000000-0000-0000-0000-0000000009b4' and is_reversal),
    'banco', 'credit'),
  400::numeric,
  'the reversal credits the account the receipt was booked to, not its current role'
);
select is(
  (select sum(l.debit) - sum(l.credit) from public.journal_entry_lines l
     join public.journal_entries e on e.id = l.journal_entry_id
    where e.source_id = '00000000-0000-0000-0000-0000000009b4'),
  0::numeric,
  'entry plus reversal net to zero'
);
select is(pg_temp.live_entries('receipts', '00000000-0000-0000-0000-0000000009b4'), 0, 'a cancelled receipt has no live entry');

-- Cost center NULL at posting, X on the document later (behind the triggers'
-- back): the reversal keeps the NULL it was booked with.
reset role;
set local session_replication_role = replica;
update public.receipts set cost_center_id = '00000000-0000-0000-0000-0000000009cc'
 where id = '00000000-0000-0000-0000-0000000009b5';
set local session_replication_role = origin;
set local role authenticated;
update public.receipts set status = 'canceled', canceled_at = now()
 where id = '00000000-0000-0000-0000-0000000009b5';
select is(
  (select cost_center_id from public.journal_entries
    where source_id = '00000000-0000-0000-0000-0000000009b5' and is_reversal),
  null::uuid,
  'the reversal clones the NULL cost center'
);

update public.payment_orders set status = 'canceled', canceled_at = now()
 where id = '00000000-0000-0000-0000-0000000009c1';
select is(
  pg_temp.role_amount(
    (select id from public.journal_entries where source_id = '00000000-0000-0000-0000-0000000009c1' and is_reversal),
    'proveedores', 'credit'),
  800::numeric,
  'a cancelled payment order reverses its entry'
);

-- Payment orders: edits re-post once ------------------------------------------

reset role;
set constraints all deferred;
insert into public.payment_orders (id, channel_id, punto_venta, numero, supplier_id, payment_date, total_amount, currency)
values ('00000000-0000-0000-0000-0000000009c3', 'jouve_fiscal', 3, 99003, '00000000-0000-0000-0000-00000000b901', current_date, 50, 'ARS');
insert into public.payment_order_payment_lines (payment_order_id, account_id, amount) values
  ('00000000-0000-0000-0000-0000000009c3', '00000000-0000-0000-0000-00000000a901', 50);
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000009f1","role":"authenticated"}', true);
set local role authenticated;
set constraints all immediate;
select lives_ok(
  $$set constraints all deferred;
    select public.update_payment_order('00000000-0000-0000-0000-0000000009c3', current_date, 75, null,
      '[{"account_id":"00000000-0000-0000-0000-00000000a901","amount":75}]'::jsonb, '[]'::jsonb);
    set constraints all immediate$$,
  'editing a fiscal payment order''s total re-posts'
);
select is(
  pg_temp.role_amount(pg_temp.live_entry('payment_orders', '00000000-0000-0000-0000-0000000009c3'), 'proveedores', 'debit'),
  75::numeric,
  'with a single live entry for the new total'
);

-- Closed period ----------------------------------------------------------------

reset role;
insert into public.accounting_closed_periods (period) values ('1999-01');
set local role authenticated;

select lives_ok(
  $$set constraints all deferred;
    select public.update_receipt('00000000-0000-0000-0000-0000000009b2', '1999-01-15', 500, 'nota nueva',
      '[{"account_id":"00000000-0000-0000-0000-00000000a901","amount":500}]'::jsonb, '[]'::jsonb, '[]'::jsonb);
    set constraints all immediate$$,
  'editing only the notes of a receipt in a closed period goes through'
);
select throws_ok(
  $$set constraints all deferred;
    select public.update_receipt('00000000-0000-0000-0000-0000000009b2', '1999-01-15', 550, null,
      '[{"account_id":"00000000-0000-0000-0000-00000000a901","amount":550}]'::jsonb, '[]'::jsonb, '[]'::jsonb);
    set constraints all immediate$$,
  '55006',
  null,
  'changing a receipt''s total in a closed period is rejected'
);
select throws_ok(
  $$update public.receipts set status = 'canceled', canceled_at = now()
     where id = '00000000-0000-0000-0000-0000000009b6'$$,
  '55006',
  null,
  'cancelling a receipt of a closed period is rejected'
);

-- Purchases: items, header + items, cost center --------------------------------

select lives_ok(
  $$set constraints all deferred;
    select public.replace_purchase_invoice_items('00000000-0000-0000-0000-0000000009d1',
      '[{"description":"x","quantity":1,"unit_price":200,"iva_rate_id":5,"line_neto":200,"line_iva":42,"line_total":242}]'::jsonb);
    set constraints all immediate$$,
  'replacing the items of a received purchase re-posts'
);
select is(
  (select count(*)::int from public.journal_entries where source_id = '00000000-0000-0000-0000-0000000009d1'),
  1,
  'with one entry (items no longer post on their own)'
);
select is(
  pg_temp.role_amount(pg_temp.live_entry('purchase_invoices', '00000000-0000-0000-0000-0000000009d1'), 'proveedores', 'credit'),
  242::numeric,
  'the entry follows the items'' totals'
);

select lives_ok(
  $$set constraints all deferred;
    update public.purchase_invoices set imp_neto = 300, imp_iva = 63, imp_total = 363
     where id = '00000000-0000-0000-0000-0000000009d1';
    select public.replace_purchase_invoice_items('00000000-0000-0000-0000-0000000009d1',
      '[{"description":"y","quantity":1,"unit_price":250,"iva_rate_id":5,"line_neto":250,"line_iva":52.5,"line_total":302.5}]'::jsonb);
    set constraints all immediate$$,
  'header then items in one transaction'
);
select is(
  pg_temp.role_amount(pg_temp.live_entry('purchase_invoices', '00000000-0000-0000-0000-0000000009d1'), 'iva_credito', 'debit'),
  52.5::numeric,
  'posts the final state once'
);

update public.purchase_invoices set cost_center_id = '00000000-0000-0000-0000-0000000009cc'
 where id = '00000000-0000-0000-0000-0000000009d1';
set constraints all immediate;
select is(
  (select cost_center_id from public.journal_entries
    where id = pg_temp.live_entry('purchase_invoices', '00000000-0000-0000-0000-0000000009d1')),
  '00000000-0000-0000-0000-0000000009cc'::uuid,
  'changing the cost center moves the entry to it'
);
select is(pg_temp.live_entries('purchase_invoices', '00000000-0000-0000-0000-0000000009d1'), 1, 'still one live entry');

-- Purchases: guards ---------------------------------------------------------------

select lives_ok(
  $$update public.purchase_invoices set notes = 'corregida'
     where id = '00000000-0000-0000-0000-0000000009d2'$$,
  'notes of a purchase in a closed period can change'
);
select throws_ok(
  $$update public.purchase_invoices set numero = 99999
     where id = '00000000-0000-0000-0000-0000000009d2'$$,
  '55006',
  'El período contable de la factura está cerrado: no se pueden cambiar datos que figuran en el Libro IVA Compras',
  'a Libro IVA field of a purchase in a closed period cannot change'
);
select throws_ok(
  $$update public.purchase_invoices set channel_id = 'jouve_internal'
     where id = '00000000-0000-0000-0000-0000000009d1'$$,
  '23514',
  'No se puede cambiar el canal de una factura de compra recibida: anulala y cargala en el canal correcto',
  'a received purchase cannot change channel'
);
select throws_ok(
  $$update public.purchase_invoices set kind = 'nd'
     where id = '00000000-0000-0000-0000-0000000009d3'$$,
  '23514',
  'No se puede cambiar el tipo de una factura de compra que ya tiene imputaciones o notas de crédito',
  'an allocated purchase cannot change kind'
);
select throws_ok(
  $$set constraints all deferred;
    update public.purchase_invoices set imp_neto = 50, imp_total = 50
     where id = '00000000-0000-0000-0000-0000000009d3';
    set constraints all immediate$$,
  '23514',
  'La edición deja un comprobante con más pagado o acreditado que su total',
  'an edit cannot leave a paid purchase with a negative open amount'
);

-- D2: fiscal letter -----------------------------------------------------------------

select throws_ok(
  $$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_total, status)
    values ('jouve_fiscal', '00000000-0000-0000-0000-00000000b901', 'factura', 7, 99010, current_date, 10, 'received')$$,
  '23514',
  'Una factura de compra fiscal lleva letra (A, B o C)',
  'a fiscal purchase needs a letter'
);
select lives_ok(
  $$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_total, status)
    values ('jouve_internal', '00000000-0000-0000-0000-00000000b901', 'factura', 1, 99011, current_date, 10, 'received')$$,
  'an internal purchase does not'
);

reset role;
set local session_replication_role = replica;
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_total, status)
values ('00000000-0000-0000-0000-0000000009d9', 'jouve_fiscal', '00000000-0000-0000-0000-00000000b901',
        'factura', 7, 99012, current_date, 10, 'received');
set local session_replication_role = origin;
set local role authenticated;
select lives_ok(
  $$update public.purchase_invoices set imp_neto = 20, imp_total = 20
     where id = '00000000-0000-0000-0000-0000000009d9'$$,
  'a historical fiscal purchase without letter can still be corrected'
);
reset role;
select ok(
  exists (select 1 from public.purchase_invoices_fiscal_without_letter()
           where purchase_invoice_id = '00000000-0000-0000-0000-0000000009d9'),
  'and the diagnostic lists it'
);

-- Aging parity: v_supplier_aging_documents on v_purchase_invoice_open gives
-- the rows of its previous formula.
select is_empty(
  $$(select pi.id, pi.imp_total - coalesce(alloc.applied, 0) - coalesce(nc.credited, 0) - coalesce(opening.applied, 0)
       from public.purchase_invoices pi
       left join (select poa.purchase_invoice_id, sum(poa.amount_applied) as applied
                    from public.payment_order_allocations poa
                    join public.payment_orders po on po.id = poa.payment_order_id
                   where po.status = 'issued' group by poa.purchase_invoice_id) alloc on alloc.purchase_invoice_id = pi.id
       left join (select nc_1.invoice_origin_id, sum(nc_1.imp_total) as credited
                    from public.purchase_invoices nc_1
                   where nc_1.kind = 'nc' and nc_1.status = 'received' and nc_1.invoice_origin_id is not null
                   group by nc_1.invoice_origin_id) nc on nc.invoice_origin_id = pi.id
       left join (select soba.purchase_invoice_id, soba.amount_applied as applied
                    from public.supplier_opening_balance_allocations soba) opening on opening.purchase_invoice_id = pi.id
      where pi.status = 'received' and pi.kind in ('factura', 'nd')
        and pi.imp_total - coalesce(alloc.applied, 0) - coalesce(nc.credited, 0) - coalesce(opening.applied, 0) > 0
     except
     select purchase_invoice_id, open_amount from public.v_supplier_aging_documents)
    union all
    (select purchase_invoice_id, open_amount from public.v_supplier_aging_documents
     except
     select pi.id, pi.imp_total - coalesce(alloc.applied, 0) - coalesce(nc.credited, 0) - coalesce(opening.applied, 0)
       from public.purchase_invoices pi
       left join (select poa.purchase_invoice_id, sum(poa.amount_applied) as applied
                    from public.payment_order_allocations poa
                    join public.payment_orders po on po.id = poa.payment_order_id
                   where po.status = 'issued' group by poa.purchase_invoice_id) alloc on alloc.purchase_invoice_id = pi.id
       left join (select nc_1.invoice_origin_id, sum(nc_1.imp_total) as credited
                    from public.purchase_invoices nc_1
                   where nc_1.kind = 'nc' and nc_1.status = 'received' and nc_1.invoice_origin_id is not null
                   group by nc_1.invoice_origin_id) nc on nc.invoice_origin_id = pi.id
       left join (select soba.purchase_invoice_id, soba.amount_applied as applied
                    from public.supplier_opening_balance_allocations soba) opening on opening.purchase_invoice_id = pi.id
      where pi.status = 'received' and pi.kind in ('factura', 'nd')
        and pi.imp_total - coalesce(alloc.applied, 0) - coalesce(nc.credited, 0) - coalesce(opening.applied, 0) > 0)$$,
  'supplier aging keeps its open amounts'
);

-- Internal journal functions are not callable by authenticated -----------------

select ok(
  not has_function_privilege('authenticated', 'public.repost_journal(text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.reverse_journal_entry(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.emit_journal(text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.current_journal_entries(text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.journal_entry_status(text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.journal_expected_entry(text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.journal_missing_entries()', 'execute')
  and not has_function_privilege('authenticated', 'public.purchase_invoices_fiscal_without_letter()', 'execute'),
  'authenticated cannot run the journal internals'
);
select ok(
  not has_function_privilege('authenticated', 'public.build_invoice_journal_lines(public.invoices, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.build_purchase_invoice_journal_lines(public.purchase_invoices, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.build_receipt_journal_lines(public.receipts, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.build_payment_order_journal_lines(public.payment_orders, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.build_transaction_journal_lines(public.transactions, text)', 'execute'),
  'authenticated cannot run the builders'
);
select ok(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname like 'emit_journal_for_%'
                 and p.proname not in ('emit_journal_for_issued_check_transition', 'emit_journal_for_endorsed_check_rejected')),
  'the per-origin emitters are gone'
);

select * from finish();

rollback;
