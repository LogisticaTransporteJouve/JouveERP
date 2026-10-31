-- Cuentas por cobrar y pagar: a rejected check of a receipt ages as its own
-- document and a later receipt can settle it (crediting cheques_rechazados);
-- statements carry the currency; supplier aging runs from the due date; a
-- standalone own check leaves the bank when cashed; treasury knows which
-- document owns a movement. One transaction, rolled back. Deferred journals
-- are flushed with `set constraints all immediate`.

begin;

select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'finance@receivables.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000000e1', 'finance');

insert into public.clients (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000c901', '20444444445', 'Cliente Cobrar', 'responsable_inscripto'),
  ('00000000-0000-0000-0000-00000000c902', '20444444446', 'Otro Cliente', 'responsable_inscripto');
insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000b901', '30444444447', 'Proveedor Pagar', 'responsable_inscripto');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000a901', 'Cartera cobrar', 'checks', 'ARS'),
  ('00000000-0000-0000-0000-00000000a902', 'Banco cobrar', 'bank', 'ARS'),
  ('00000000-0000-0000-0000-00000000a903', 'Banco USD cobrar', 'bank', 'USD');

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, fch_vto_pago,
   imp_neto, imp_total, moneda, cotizacion, status)
values
  ('00000000-0000-0000-0000-0000000091a1', 'jouve_internal', '00000000-0000-0000-0000-00000000b901',
   'factura', null, 9, 9101, current_date - 50, current_date - 10, 500, 500, 'PES', 1, 'received');

create temp table settle_lines on commit drop as
  select null::text as role, 0::numeric as debit, 0::numeric as credit limit 0;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);

-- A fiscal receipt paid with a check, which then bounces --------------------

select public.create_receipt(
  'jouve_fiscal', 9, 9201, '00000000-0000-0000-0000-00000000c901', current_date, 100, 'ARS', null,
  jsonb_build_array(jsonb_build_object(
    'account_id', '00000000-0000-0000-0000-00000000a901', 'amount', 100, 'reference', 'CH-901',
    'check', jsonb_build_object('check_number', 'CH-901', 'bank_name', 'Banco Z',
      'drawer_name', 'Firmante', 'due_date', current_date))),
  '[]'::jsonb, '[]'::jsonb);

set constraints all immediate;
set constraints all deferred;

select public.reject_check(
  (select id from public.checks where check_number = 'CH-901'), null, current_date, null, null);

-- 2. Aging: the rejected check is its own document --------------------------

select results_eq(
  $$select document_type, invoice_id, open_amount, moneda, days_overdue
      from public.v_aging_documents
     where document_id = (select id from public.checks where check_number = 'CH-901')$$,
  $$values ('rejected_check'::text, null::uuid, 100.00::numeric, 'PES'::text, 0)$$,
  'a rejected receipt check ages as a rejected_check document from the rejection day'
);

select is(
  (select ars_rejected_checks_open from public.v_client_aging
    where client_id = '00000000-0000-0000-0000-00000000c901'),
  100.00::numeric,
  'the client aging says how much of its total is rejected-check debt'
);

select is(
  (select ars_total_open from public.v_client_aging_by_scope
    where client_id = '00000000-0000-0000-0000-00000000c901' and channel_is_fiscal),
  100.00::numeric,
  'the fiscal scope of the aging counts the rejected check'
);

select is(
  (select (public.clients(a)).legal_name from public.v_client_aging a
    where a.client_id = '00000000-0000-0000-0000-00000000c901'),
  'Cliente Cobrar',
  'the aging view keeps its clients relationship for the embed'
);

-- 3. A receipt settles part of the rejected check ---------------------------

select lives_ok(
  $$select public.create_receipt(
      'jouve_fiscal', 9, 9202, '00000000-0000-0000-0000-00000000c901', current_date, 60, 'ARS', null,
      jsonb_build_array(jsonb_build_object(
        'account_id', '00000000-0000-0000-0000-00000000a902', 'amount', 60)),
      jsonb_build_array(jsonb_build_object(
        'rejected_check_id', (select id from public.checks where check_number = 'CH-901'),
        'amount_applied', 60)),
      '[]'::jsonb)$$,
  'a receipt settles a rejected check'
);

set constraints all immediate;
set constraints all deferred;

select is(
  (select open_amount from public.v_rejected_check_open
    where check_number = 'CH-901'),
  40.00::numeric,
  'what the receipt settled leaves the check open for the rest'
);

select throws_ok(
  $$select public.create_receipt(
      'jouve_fiscal', 9, 9203, '00000000-0000-0000-0000-00000000c901', current_date, 50, 'ARS', null,
      jsonb_build_array(jsonb_build_object(
        'account_id', '00000000-0000-0000-0000-00000000a902', 'amount', 50)),
      jsonb_build_array(jsonb_build_object(
        'rejected_check_id', (select id from public.checks where check_number = 'CH-901'),
        'amount_applied', 50)),
      '[]'::jsonb)$$,
  '23514',
  null,
  'a receipt cannot settle more than the check still owes'
);

select throws_ok(
  $$select public.create_receipt(
      'jouve_fiscal', 9, 9204, '00000000-0000-0000-0000-00000000c901', current_date, 10, 'USD', null,
      jsonb_build_array(jsonb_build_object(
        'account_id', '00000000-0000-0000-0000-00000000a903', 'amount', 10)),
      jsonb_build_array(jsonb_build_object(
        'rejected_check_id', (select id from public.checks where check_number = 'CH-901'),
        'amount_applied', 10)),
      '[]'::jsonb, 1000)$$,
  '23514',
  'El cheque rechazado está en otra moneda que el recibo: un recibo solo cancela deuda de su misma moneda',
  'a receipt cannot settle a rejected check in another currency'
);

select throws_ok(
  $$select public.create_receipt(
      'jouve_fiscal', 9, 9205, '00000000-0000-0000-0000-00000000c902', current_date, 10, 'ARS', null,
      jsonb_build_array(jsonb_build_object(
        'account_id', '00000000-0000-0000-0000-00000000a902', 'amount', 10)),
      jsonb_build_array(jsonb_build_object(
        'rejected_check_id', (select id from public.checks where check_number = 'CH-901'),
        'amount_applied', 10)),
      '[]'::jsonb)$$,
  '23514',
  'El cheque rechazado no es del cliente del recibo',
  'a receipt cannot settle another client''s rejected check'
);

-- 1. Statements carry the currency --------------------------------------------

select results_eq(
  $$select source_type, currency, signed_amount from public.v_client_account_movements
     where client_id = '00000000-0000-0000-0000-00000000c901'
     order by source_type, numero$$,
  $$values ('receipt'::text, 'ARS'::text, -100.00::numeric),
           ('receipt'::text, 'ARS'::text, -60.00::numeric),
           ('rejected_check'::text, 'ARS'::text, 100.00::numeric)$$,
  'the client statement carries each movement''s currency and keeps the rejected check'
);

select is(
  (select currency from public.v_supplier_account_movements
    where source_id = '00000000-0000-0000-0000-0000000091a1'),
  'ARS',
  'the supplier statement carries the currency'
);

-- 4. Supplier aging from the due date -----------------------------------------

select results_eq(
  $$select days_overdue, bucket from public.v_supplier_aging_documents
     where purchase_invoice_id = '00000000-0000-0000-0000-0000000091a1'$$,
  $$values (10, '0_30'::text)$$,
  'supplier aging counts days from fch_vto_pago, not fecha'
);

-- 6. A standalone own check leaves the bank when cashed ------------------------

insert into public.issued_checks
  (id, kind, check_number, bank_name, issue_date, due_date, amount, currency, bank_account_id,
   supplier_id, channel_id)
values
  ('00000000-0000-0000-0000-0000000093a1', 'fisico', 'OWN-901', 'Banco cobrar', current_date,
   current_date, 75, 'ARS', '00000000-0000-0000-0000-00000000a902',
   '00000000-0000-0000-0000-00000000b901', 'jouve_fiscal');

select is(
  (select count(*)::int from public.transactions
    where issued_check_id = '00000000-0000-0000-0000-0000000093a1'),
  0,
  'issuing a standalone own check moves no money'
);

update public.issued_checks set status = 'cashed', cashed_at = current_date
 where id = '00000000-0000-0000-0000-0000000093a1';

select results_eq(
  $$select account_id, kind, amount, transaction_date from public.transactions
     where issued_check_id = '00000000-0000-0000-0000-0000000093a1'$$,
  $$values ('00000000-0000-0000-0000-00000000a902'::uuid, 'expense'::text, 75.00::numeric, current_date)$$,
  'cashing it writes the bank outflow on the cashing date'
);

select throws_ok(
  $$update public.transactions set amount = 1
     where issued_check_id = '00000000-0000-0000-0000-0000000093a1'$$,
  '55006',
  null,
  'the cashing outflow is not edited from treasury'
);

select is(
  (select source_document from public.v_transactions_tagged
    where issued_check_id = '00000000-0000-0000-0000-0000000093a1'),
  'issued_check',
  'treasury knows the cashed check owns its outflow'
);

select public.create_payment_order(
  'jouve_fiscal', 9, 9301, '00000000-0000-0000-0000-00000000b901', current_date, 30, 'ARS', null,
  jsonb_build_array(jsonb_build_object(
    'line_kind', 'issue_check', 'account_id', '00000000-0000-0000-0000-00000000a902', 'amount', 30,
    'issued_check', jsonb_build_object('kind', 'fisico', 'check_number', 'OWN-902',
      'bank_name', 'Banco cobrar', 'due_date', current_date))),
  '[]'::jsonb);

update public.issued_checks set status = 'cashed', cashed_at = current_date
 where check_number = 'OWN-902';

select is(
  (select count(*)::int from public.transactions t
     join public.issued_checks ic on ic.id = t.issued_check_id
    where ic.check_number = 'OWN-902'),
  0,
  'a check of a payment order left the bank with the OP: cashing adds nothing'
);

-- 5. Treasury: owner of each movement ------------------------------------------

select is(
  (select array_agg(distinct source_document) from public.v_transactions_tagged
    where description like 'Recibo R0009-0000920%'),
  array['receipt'],
  'receipt movements are owned by the receipt'
);

select is(
  (select source_document from public.v_transactions_tagged
    where rejected_check_id = (select id from public.checks where check_number = 'CH-901')),
  'rejected_check',
  'the rejection outflow is owned by the check'
);

reset role;

-- Postings ---------------------------------------------------------------------

set constraints all immediate;

insert into settle_lines
  select coa.system_role::text, l.debit, l.credit
    from public.journal_entries je
    join public.journal_entry_lines l on l.journal_entry_id = je.id
    join public.chart_of_accounts coa on coa.id = l.chart_of_accounts_id
   where je.source_table = 'receipts'
     and je.source_id = (select id from public.receipts where numero = 9202 and punto_venta = 9);

select results_eq(
  $$select role, debit, credit from settle_lines order by debit desc, role$$,
  $$values ('banco'::text, 60.00::numeric, 0::numeric),
           ('cheques_rechazados'::text, 0::numeric, 60.00::numeric)$$,
  'the settling receipt credits cheques_rechazados, not clientes'
);

select is(
  (select count(*)::int
     from public.journal_entries je
     join public.transactions t on je.source_table = 'transactions' and je.source_id = t.id
    where t.issued_check_id is not null),
  0,
  'the cashing outflow posts nothing: the check already credits the bank'
);

select is(
  (select count(*)::int from public.journal_entries
    where source_table = 'issued_checks' and source_id = '00000000-0000-0000-0000-0000000093a1'),
  1,
  'the cashed check posts its own entry once'
);

select ok(
  not has_function_privilege('anon', 'public.clients(public.v_client_aging)', 'execute'),
  'anon cannot call the aging computed relationship'
);

select ok(
  not has_function_privilege('authenticated', 'public.guard_receipt_rejected_check_allocation()', 'execute'),
  'the settlement guard is not callable'
);

select * from finish();
rollback;
