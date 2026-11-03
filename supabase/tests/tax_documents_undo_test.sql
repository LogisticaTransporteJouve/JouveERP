-- Impuestos: deshacer un pago y los follow-ups de 20261103220000..220300.
-- pay_tax_document and link_tax_document_payment record their origin (and
-- the expense account a linked movement had); undo_tax_document_payment
-- deletes the movement "Pagar" booked, releases a linked one with its
-- expense account and re-posts it, is a no-op on a document no longer
-- paid, and refuses a booked payment reconciled with the statement and a
-- closed period. guard_tax_document keeps the new columns to pay/link.
-- Cash gestión puts a tax payment on operating_cost / impuestos. Only an
-- IVA document carries a saldo a favor. The accountant reads a tax
-- document's attachment and nothing else. One transaction, rolled back.

begin;

select plan(30);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- The live entry's debit on one account for a movement.
create function pg_temp.debit_on(p_tx uuid, p_account uuid) returns numeric
language sql as $$
  select coalesce(sum(l.debit), 0) from public.journal_entries je
    join public.journal_entry_lines l on l.journal_entry_id = je.id
   where je.source_table = 'transactions' and je.source_id = p_tx and not je.is_reversal
     and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = je.id)
     and l.chart_of_accounts_id = p_account;
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f001', 'owner@taxundo.test'),
  ('00000000-0000-0000-0000-00000000f002', 'contador@taxundo.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-00000000f001', 'owner'),
  ('00000000-0000-0000-0000-00000000f002', 'fiscal_reader');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000f101', 'Banco Impuestos Undo', 'bank', 'ARS');

create temporary table t_coa as
  select (select id from public.chart_of_accounts where system_role = 'iva_debito') as tax_account,
         (select id from public.expense_leaf_accounts order by code limit 1) as expense_account;

insert into public.tax_documents (id, kind, period, due_date, amount, account_id, created_by) values
  ('00000000-0000-0000-0000-00000000f201', 'iva', '2026-09', '2026-10-20', 1000,
   (select tax_account from t_coa), '00000000-0000-0000-0000-00000000f001'),
  ('00000000-0000-0000-0000-00000000f202', 'iibb', '2026-09', '2026-10-15', 500,
   (select tax_account from t_coa), '00000000-0000-0000-0000-00000000f001'),
  ('00000000-0000-0000-0000-00000000f203', 'sicore', '2026-09', '2026-10-10', 300,
   (select tax_account from t_coa), '00000000-0000-0000-0000-00000000f001'),
  ('00000000-0000-0000-0000-00000000f204', 'ganancias_anticipo', '1999-02', '1999-03-10', 700,
   (select tax_account from t_coa), '00000000-0000-0000-0000-00000000f001');

insert into public.transactions
  (id, account_id, channel_id, kind, amount, currency, transaction_date, accrual_month,
   description, expense_account_id)
values
  ('00000000-0000-0000-0000-00000000f301', '00000000-0000-0000-0000-00000000f101', 'jouve_fiscal',
   'expense', 500, 'ARS', '2026-10-15', '2026-10-01', 'Transferencia ARBA',
   (select expense_account from t_coa)),
  ('00000000-0000-0000-0000-00000000f304', '00000000-0000-0000-0000-00000000f101', 'jouve_fiscal',
   'expense', 700, 'ARS', '1999-03-10', '1999-03-01', 'Anticipo viejo', null);

-- A statement debit the SICORE payment is booked from (and reconciled with).
create temporary table t_stmt as
  select public.commit_import_run(
    'bank_statement', 'extracto-undo.csv', repeat('8', 64), '{}'::jsonb, 1, 0, 0,
    jsonb_build_array(
      jsonb_build_object('account_id', '00000000-0000-0000-0000-00000000f101', 'line_date', '2026-10-10',
        'description', 'Débito SICORE undo', 'amount', -300, 'balance', null, 'reference', null,
        'source_hash', repeat('f', 64), 'line_no', 2)
    ),
    '00000000-0000-0000-0000-00000000f001') as id;

-- 1. Grants -----------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated',
        'public.undo_tax_document_payment(uuid, uuid)', 'execute')
  and has_function_privilege('service_role',
        'public.undo_tax_document_payment(uuid, uuid)', 'execute'),
  'only the service role undoes a payment'
);

-- 2. Pay and link record their origin --------------------------------------------

create temporary table t_pay as
  select public.pay_tax_document('00000000-0000-0000-0000-00000000f201', '2026-10-20',
    '00000000-0000-0000-0000-00000000f101', 1000) as tx_id;
select public.link_tax_document_payment('00000000-0000-0000-0000-00000000f202',
  '00000000-0000-0000-0000-00000000f301', '00000000-0000-0000-0000-00000000f001');
set constraints all immediate;

select results_eq(
  $$select payment_origin, payment_previous_expense_account_id from public.tax_documents
     where id = '00000000-0000-0000-0000-00000000f201'$$,
  $$values ('pay'::text, null::uuid)$$,
  '"Pagar" records its origin'
);
select results_eq(
  $$select payment_origin, payment_previous_expense_account_id from public.tax_documents
     where id = '00000000-0000-0000-0000-00000000f202'$$,
  $$select 'link'::text, expense_account from t_coa$$,
  '"Vincular" records its origin and the expense account the movement had'
);

-- 3. Cash gestión: a tax payment is a tax line ------------------------------------

create temporary table t_pnl as
  select * from public.management_pnl_lines('2026-10-01', '2026-10-31', 'cash');
select results_eq(
  $$select bucket, subbucket, chart_account_id, amount_ars from t_pnl
     where source_table = 'transactions' and source_id = (select tx_id from t_pay)$$,
  $$select 'operating_cost'::text, 'impuestos'::text, tax_account, -1000::numeric from t_coa$$,
  'in cash, the payment lands on operating_cost / impuestos against the tax account'
);
select is(
  (select count(*)::int from t_pnl
    where source_id = (select tx_id from t_pay) and subbucket = 'otros'),
  0,
  'and no longer on the gastos line'
);

-- 4. Guards on the new columns -----------------------------------------------------

select throws_ok(
  $$update public.tax_documents set payment_origin = 'pay'
     where id = '00000000-0000-0000-0000-00000000f203'$$,
  '23514', null, 'nobody but pay/link writes the payment origin'
);
select throws_ok(
  $$update public.tax_documents set status = 'liquidado'
     where id = '00000000-0000-0000-0000-00000000f201'$$,
  '55006', null, 'a paid document is still frozen outside the undo'
);

-- 5. Undo "Pagar": the movement goes ------------------------------------------------

create temporary table t_undo_pay as
  select * from public.undo_tax_document_payment('00000000-0000-0000-0000-00000000f201',
    '00000000-0000-0000-0000-00000000f001');
set constraints all immediate;

select results_eq(
  $$select transaction_id, origin, movement_deleted, expense_account_restored from t_undo_pay$$,
  $$select tx_id, 'pay'::text, true, false from t_pay$$,
  'undoing "Pagar" reports the deleted movement'
);
select results_eq(
  $$select status, payment_transaction_id, paid_date, paid_amount, payment_origin,
           notes like '%deshecho%'
      from public.tax_documents where id = '00000000-0000-0000-0000-00000000f201'$$,
  $$values ('liquidado'::text, null::uuid, null::date, null::numeric(18,2), null::text, true)$$,
  'the document is open again (liquidado: its amount is not an estimate) and notes the undo'
);
select is(
  (select count(*)::int from public.transactions where id = (select tx_id from t_pay)),
  0, 'the movement "Pagar" booked is deleted'
);
select is(
  (select count(*)::int from public.journal_entries
    where source_table = 'transactions' and source_id = (select tx_id from t_pay)),
  0, 'with its entry'
);

create temporary table t_undo_again as
  select * from public.undo_tax_document_payment('00000000-0000-0000-0000-00000000f201',
    '00000000-0000-0000-0000-00000000f001');
select is((select count(*)::int from t_undo_again), 0,
  'undoing again returns nothing and changes nothing');

-- 6. Undo "Vincular": the movement stays, with its expense account -----------------

create temporary table t_undo_link as
  select * from public.undo_tax_document_payment('00000000-0000-0000-0000-00000000f202',
    '00000000-0000-0000-0000-00000000f001');
set constraints all immediate;

select results_eq(
  $$select transaction_id, origin, movement_deleted, expense_account_restored from t_undo_link$$,
  $$values ('00000000-0000-0000-0000-00000000f301'::uuid, 'link'::text, false, true)$$,
  'undoing a link reports the released movement'
);
select results_eq(
  $$select expense_account_id, amount, transaction_date from public.transactions
     where id = '00000000-0000-0000-0000-00000000f301'$$,
  $$select expense_account, 500::numeric(18,2), '2026-10-15'::date from t_coa$$,
  'the movement gets its expense account back, money fields untouched'
);
select is(pg_temp.debit_on('00000000-0000-0000-0000-00000000f301', (select expense_account from t_coa)),
  500::numeric, 'its entry debits the expense account again');
select is(pg_temp.debit_on('00000000-0000-0000-0000-00000000f301', (select tax_account from t_coa)),
  0::numeric, 'and no longer the tax account');
select is(
  (select source_document from public.v_transactions_tagged where id = '00000000-0000-0000-0000-00000000f301'),
  null, 'Caja shows it as a loose movement'
);
select results_eq(
  $$select status, payment_origin, payment_previous_expense_account_id
      from public.tax_documents where id = '00000000-0000-0000-0000-00000000f202'$$,
  $$values ('liquidado'::text, null::text, null::uuid)$$,
  'the document is open again'
);
select lives_ok(
  $$select public.link_tax_document_payment('00000000-0000-0000-0000-00000000f202',
      '00000000-0000-0000-0000-00000000f301', '00000000-0000-0000-0000-00000000f001')$$,
  'the released movement can be linked again'
);

-- 7. A booked payment reconciled with the statement --------------------------------

create temporary table t_line_tx as
  select public.create_bank_statement_line_tax_payment(
    (select id from public.bank_statement_lines where import_run_id = (select id from t_stmt)),
    '00000000-0000-0000-0000-00000000f203',
    '00000000-0000-0000-0000-00000000f001') as tx_id;
set constraints all immediate;

select throws_ok(
  $$select * from public.undo_tax_document_payment('00000000-0000-0000-0000-00000000f203',
      '00000000-0000-0000-0000-00000000f001')$$,
  '55006', 'El pago está conciliado con el extracto bancario: desconciliá la línea antes de deshacerlo',
  'a booked payment reconciled with the statement is refused'
);
select is(
  (select status from public.tax_documents where id = '00000000-0000-0000-0000-00000000f203'),
  'pagado', 'and stays paid'
);

-- 8. Closed period -------------------------------------------------------------------

select public.link_tax_document_payment('00000000-0000-0000-0000-00000000f204',
  '00000000-0000-0000-0000-00000000f304', '00000000-0000-0000-0000-00000000f001');
set constraints all immediate;
insert into public.accounting_closed_periods (period) values ('1999-03');
select throws_ok(
  $$select * from public.undo_tax_document_payment('00000000-0000-0000-0000-00000000f204',
      '00000000-0000-0000-0000-00000000f001')$$,
  '55006', null, 'a payment in a closed period is refused'
);
select is(
  (select status from public.tax_documents where id = '00000000-0000-0000-0000-00000000f204'),
  'pagado', 'and stays paid'
);

-- 9. Saldo a favor técnico: IVA only ------------------------------------------------

select lives_ok(
  $$update public.tax_documents set credit_balance = 250
     where id = '00000000-0000-0000-0000-00000000f201'$$,
  'an IVA document takes a saldo a favor'
);
select throws_ok(
  $$insert into public.tax_documents (kind, period, due_date, credit_balance, created_by)
    values ('iibb', '2026-08', '2026-09-15', 100, '00000000-0000-0000-0000-00000000f001')$$,
  '23514', null, 'another kind does not'
);
select throws_ok(
  $$update public.tax_documents set credit_balance = 0
     where id = '00000000-0000-0000-0000-00000000f201'$$,
  '23514', null, 'nor a zero balance'
);

-- 10. The accountant reads a tax document's attachment, nothing else ---------------

insert into public.files (id, bucket_path, original_filename, source, uploaded_by) values
  ('00000000-0000-0000-0000-00000000f401', '00000000-0000-0000-0000-00000000f401.pdf',
   'vep.pdf', 'manual_upload', '00000000-0000-0000-0000-00000000f001'),
  ('00000000-0000-0000-0000-00000000f402', '00000000-0000-0000-0000-00000000f402.pdf',
   'transferencia.pdf', 'manual_upload', '00000000-0000-0000-0000-00000000f001');
insert into public.file_attachments (file_id, kind, tax_document_id, created_by) values
  ('00000000-0000-0000-0000-00000000f401', 'vep', '00000000-0000-0000-0000-00000000f201',
   '00000000-0000-0000-0000-00000000f001');
insert into public.file_attachments (file_id, kind, transaction_id, created_by) values
  ('00000000-0000-0000-0000-00000000f402', 'comprobante', '00000000-0000-0000-0000-00000000f301',
   '00000000-0000-0000-0000-00000000f001');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000f002","role":"authenticated"}', true);

select results_eq(
  $$select id from public.files
     where id in ('00000000-0000-0000-0000-00000000f401', '00000000-0000-0000-0000-00000000f402')$$,
  $$values ('00000000-0000-0000-0000-00000000f401'::uuid)$$,
  'the accountant sees the file of a tax document, not the movement''s'
);
select results_eq(
  $$select file_id from public.file_attachments
     where file_id in ('00000000-0000-0000-0000-00000000f401', '00000000-0000-0000-0000-00000000f402')$$,
  $$values ('00000000-0000-0000-0000-00000000f401'::uuid)$$,
  'and only the tax document''s attachment row'
);
select throws_ok(
  $$insert into public.file_attachments (file_id, kind, tax_document_id, created_by)
    values ('00000000-0000-0000-0000-00000000f401', 'ddjj', '00000000-0000-0000-0000-00000000f202',
            '00000000-0000-0000-0000-00000000f002')$$,
  '42501', null, 'the accountant cannot attach'
);

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select ok(
  public.is_tax_document_file('00000000-0000-0000-0000-00000000f401')
  and not public.is_tax_document_file('00000000-0000-0000-0000-00000000f402'),
  'is_tax_document_file tells the two apart'
);

select * from finish();
rollback;
