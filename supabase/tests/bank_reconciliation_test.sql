-- Importador tanda 2 + conciliación (20261103140000, 20261103140100): a bank
-- statement imported by commit_import_run dedupes by its source hash; a line
-- is matched only with movements of its account adding up to it; a reconciled
-- movement cannot be edited or deleted until unmatched; "no corresponde" and
-- the movement created from a line; undo refuses a statement with a matched
-- line. Cartera checks book their inflow and undo deletes it; client opening
-- balances keep their run; loans get their pending schedule. Grants. One
-- transaction, rolled back.

begin;

select plan(24);

-- The posting trigger checks the caller like the app's service client.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f501', 'owner@recon.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-00000000f501', 'owner');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000fa01', 'Banco Conciliación', 'bank', 'ARS'),
  ('00000000-0000-0000-0000-00000000fa02', 'Cartera Conciliación', 'checks', 'ARS');
insert into public.clients (id, legal_name, is_fiscal) values
  ('00000000-0000-0000-0000-00000000fc01', 'Cliente Conciliación', false);

-- 1. Grants -----------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.match_bank_statement_line(uuid, uuid[], uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.unmatch_bank_statement_line(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.set_bank_statement_line_ignored(uuid, text, uuid)', 'execute')
  and not has_function_privilege('authenticated',
        'public.create_bank_statement_line_transaction(uuid, text, uuid, uuid, uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.match_bank_statement_line(uuid, uuid[], uuid)', 'execute'),
  'only the service role runs the reconciliation RPCs'
);

select ok(
  not has_function_privilege('authenticated',
        'public.apply_client_opening_balance_core(uuid, date, numeric, text, uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated',
        'public.import_run_outside_reference(text, uuid, text[])', 'execute'),
  'the internal helpers are not exposed'
);

-- 2. Statement import -------------------------------------------------------------

create temporary table t_stmt as
  select public.commit_import_run(
    'bank_statement', 'extracto.csv', repeat('1', 64), '{}'::jsonb, 3, 0, 0,
    jsonb_build_array(
      jsonb_build_object('account_id', '00000000-0000-0000-0000-00000000fa01', 'line_date', '2026-10-01',
        'description', 'Cobro cliente', 'amount', 1000, 'balance', 1000, 'reference', null,
        'source_hash', repeat('a', 64), 'line_no', 2),
      jsonb_build_object('account_id', '00000000-0000-0000-0000-00000000fa01', 'line_date', '2026-10-02',
        'description', 'Comisión', 'amount', -12.10, 'balance', 987.90, 'reference', null,
        'source_hash', repeat('b', 64), 'line_no', 3),
      jsonb_build_object('account_id', '00000000-0000-0000-0000-00000000fa01', 'line_date', '2026-10-03',
        'description', 'Transferencia propia', 'amount', -500, 'balance', 487.90, 'reference', null,
        'source_hash', repeat('c', 64), 'line_no', 4)
    ),
    '00000000-0000-0000-0000-00000000f501') as id;

select is(
  (select count(*)::int from public.bank_statement_lines where import_run_id = (select id from t_stmt)),
  3,
  'the statement lines are imported with their run'
);

create temporary table t_stmt_again as
  select public.commit_import_run(
    'bank_statement', 'extracto.csv', repeat('1', 64), '{}'::jsonb, 1, 0, 0,
    jsonb_build_array(
      jsonb_build_object('account_id', '00000000-0000-0000-0000-00000000fa01', 'line_date', '2026-10-01',
        'description', 'Cobro cliente', 'amount', 1000, 'balance', 1000, 'reference', null,
        'source_hash', repeat('a', 64), 'line_no', 2)
    ),
    '00000000-0000-0000-0000-00000000f501') as id;

select results_eq(
  $$select inserted_rows, skipped_rows from public.import_runs where id = (select id from t_stmt_again)$$,
  $$values (0, 1)$$,
  'an overlapping statement adds nothing twice'
);

create temporary table t_line as
  select id, description from public.bank_statement_lines
   where import_run_id = (select id from t_stmt);

insert into public.transactions
  (id, account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description)
values
  ('00000000-0000-0000-0000-00000000fe01', '00000000-0000-0000-0000-00000000fa01', 'jouve_fiscal',
   'income', 600, 'ARS', '2026-10-01', '2026-10-01', 'Cobro parte 1'),
  ('00000000-0000-0000-0000-00000000fe02', '00000000-0000-0000-0000-00000000fa01', 'jouve_fiscal',
   'income', 400, 'ARS', '2026-10-01', '2026-10-01', 'Cobro parte 2');

-- 3. Matching -----------------------------------------------------------------------

select throws_ok(
  $$select public.match_bank_statement_line(
      (select id from t_line where description = 'Cobro cliente'),
      array['00000000-0000-0000-0000-00000000fe01']::uuid[],
      '00000000-0000-0000-0000-00000000f501')$$,
  '22023',
  null,
  'movements that do not add up to the line are refused'
);

select lives_ok(
  $$select public.match_bank_statement_line(
      (select id from t_line where description = 'Cobro cliente'),
      array['00000000-0000-0000-0000-00000000fe01', '00000000-0000-0000-0000-00000000fe02']::uuid[],
      '00000000-0000-0000-0000-00000000f501')$$,
  'one line matches several movements that add up to it'
);

select is(
  (select status from public.bank_statement_lines where id = (select id from t_line where description = 'Cobro cliente')),
  'matched',
  'the line is reconciled'
);

select throws_ok(
  $$update public.transactions set amount = 601 where id = '00000000-0000-0000-0000-00000000fe01'$$,
  '55006',
  null,
  'a reconciled movement cannot change its amount'
);

select lives_ok(
  $$update public.transactions set description = 'Cobro parte 1 (Galicia)'
     where id = '00000000-0000-0000-0000-00000000fe01'$$,
  'its description can still change'
);

select throws_ok(
  $$delete from public.transactions where id = '00000000-0000-0000-0000-00000000fe02'$$,
  '55006',
  null,
  'a reconciled movement cannot be deleted'
);

select throws_ok(
  $$update public.bank_statement_lines set amount = 1 where id = (select id from t_line where description = 'Cobro cliente')$$,
  '55006',
  null,
  'a statement line never changes its data'
);

select throws_ok(
  $$select public.undo_import_run((select id from t_stmt), '00000000-0000-0000-0000-00000000f501')$$,
  '55006',
  null,
  'a statement with a reconciled line cannot be undone'
);

select lives_ok(
  $$select public.unmatch_bank_statement_line(
      (select id from t_line where description = 'Cobro cliente'), '00000000-0000-0000-0000-00000000f501')$$,
  'unmatching frees the line'
);

select lives_ok(
  $$update public.transactions set amount = 601 where id = '00000000-0000-0000-0000-00000000fe01'$$,
  'an unmatched movement can be edited again'
);

-- 4. No corresponde and a movement from a line -------------------------------------------

select lives_ok(
  $$select public.set_bank_statement_line_ignored(
      (select id from t_line where description = 'Transferencia propia'), 'Pase entre cuentas propias',
      '00000000-0000-0000-0000-00000000f501')$$,
  'a line is marked no corresponde with its reason'
);

select results_eq(
  $$select status, ignore_reason from public.bank_statement_lines
     where id = (select id from t_line where description = 'Transferencia propia')$$,
  $$values ('ignored'::text, 'Pase entre cuentas propias'::text)$$,
  'the reason is kept'
);

select throws_ok(
  $$select public.create_bank_statement_line_transaction(
      (select id from t_line where description = 'Comisión'), 'jouve_fiscal',
      '00000000-0000-0000-0000-00000000f501')$$,
  '22023',
  null,
  'a debit needs its expense account'
);

select lives_ok(
  $$select public.create_bank_statement_line_transaction(
      (select id from t_line where description = 'Comisión'), 'jouve_fiscal',
      '00000000-0000-0000-0000-00000000f501',
      (select id from public.expense_leaf_accounts order by code limit 1))$$,
  'the missing expense is created from the line'
);

select results_eq(
  $$select t.kind, t.amount, t.transaction_date, l.status
      from public.bank_statement_lines l
      join public.bank_statement_matches m on m.line_id = l.id
      join public.transactions t on t.id = m.transaction_id
     where l.id = (select id from t_line where description = 'Comisión')$$,
  $$values ('expense'::text, 12.10::numeric, '2026-10-02'::date, 'matched'::text)$$,
  'the created movement is an expense of the line and reconciles it'
);

-- 5. Go-live items ----------------------------------------------------------------------

create temporary table t_checks as
  select public.commit_import_run(
    'checks', 'cartera.xlsx', repeat('2', 64), '{}'::jsonb, 1, 0, 0,
    jsonb_build_array(jsonb_build_object(
      'kind', 'fisico', 'check_number', 'R-1', 'bank_name', 'Banco Recon', 'drawer_name', 'Acme',
      'drawer_cuit', null, 'issue_date', '2026-10-01', 'due_date', '2026-12-01', 'amount', 250,
      'currency', 'ARS', 'cartera_account_id', '00000000-0000-0000-0000-00000000fa02',
      'channel_id', 'jouve_fiscal', 'notes', null)),
    '00000000-0000-0000-0000-00000000f501') as id;

select results_eq(
  $$select t.kind, t.amount, t.account_id
      from public.transactions t
      join public.checks k on k.id = t.manual_check_id
     where k.import_run_id = (select id from t_checks)$$,
  $$values ('income'::text, 250::numeric, '00000000-0000-0000-0000-00000000fa02'::uuid)$$,
  'an imported cartera check books its inflow like one loaded by hand'
);

select lives_ok(
  $$select public.undo_import_run((select id from t_checks), '00000000-0000-0000-0000-00000000f501')$$,
  'an untouched check import is undone'
);

select is(
  (select count(*)::int from public.transactions t
     where t.description = 'Cheque recibido #R-1 Banco Recon'),
  0,
  'undoing it deletes the check and its inflow'
);

create temporary table t_opening as
  select public.commit_import_run(
    'opening_balances', 'saldos.xlsx', repeat('3', 64), '{}'::jsonb, 1, 0, 0,
    jsonb_build_array(jsonb_build_object(
      'client_id', '00000000-0000-0000-0000-00000000fc01', 'opening_date', '2026-10-31',
      'target_balance', 1234.5, 'notes', null)),
    '00000000-0000-0000-0000-00000000f501') as id;

select results_eq(
  $$select target_balance, import_run_id = (select id from t_opening)
      from public.client_opening_balances where client_id = '00000000-0000-0000-0000-00000000fc01'$$,
  $$values (1234.5::numeric, true)$$,
  'a client opening balance is imported with its run'
);

create temporary table t_loans as
  select public.commit_import_run(
    'loans', 'prestamos.xlsx', repeat('4', 64), '{}'::jsonb, 1, 0, 0,
    jsonb_build_array(jsonb_build_object(
      'kind', 'prestamo', 'description', 'Préstamo Recon', 'lender', 'Banco Recon',
      'principal', 1000, 'currency', 'ARS', 'channel_id', 'jouve_fiscal',
      'installments_count', 2, 'first_due_date', '2026-12-10', 'notes', null,
      'installments', jsonb_build_array(
        jsonb_build_object('number', 1, 'due_date', '2026-12-10', 'amount', 500),
        jsonb_build_object('number', 2, 'due_date', '2027-01-10', 'amount', 500)))),
    '00000000-0000-0000-0000-00000000f501') as id;

select is(
  (select count(*)::int from public.loan_installments i
     join public.loans l on l.id = i.loan_id
    where l.import_run_id = (select id from t_loans) and i.status = 'pendiente'),
  2,
  'an imported loan gets its pending schedule'
);

select * from finish();
rollback;
