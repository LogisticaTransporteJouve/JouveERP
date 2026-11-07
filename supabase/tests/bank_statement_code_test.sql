-- Código del banco en el extracto (20261107190000): commit_import_run keeps
-- each line's bank_code; importing the same file again over lines loaded
-- without it fills the code once (filled_rows) and inserts nothing; a code
-- never changes once set; rows without bank_code / fill_only (older app code)
-- import as before. One transaction, rolled back.

begin;

select plan(7);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f601', 'owner@code.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-00000000f601', 'owner');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000fb01', 'Banco Código', 'bank', 'ARS');

-- Older app code: no bank_code, no fill_only.
create temporary table t_old as
  select public.commit_import_run(
    'bank_statement', 'viejo.csv', repeat('2', 64), '{}'::jsonb, 2, 0, 0,
    jsonb_build_array(
      jsonb_build_object('account_id', '00000000-0000-0000-0000-00000000fb01', 'line_date', '2026-11-05',
        'description', 'DBCR 25413 S/CR TASA GRAL', 'amount', -2007.04, 'balance', 3063436.38,
        'reference', '1953630435', 'source_hash', repeat('d', 64), 'line_no', 2),
      jsonb_build_object('account_id', '00000000-0000-0000-0000-00000000fb01', 'line_date', '2026-11-05',
        'description', 'RECAUDACIONES ARBA Suc.:540', 'amount', -4348.59, 'balance', 3065469.51,
        'reference', '1952131830', 'source_hash', repeat('e', 64), 'line_no', 3)
    ),
    '00000000-0000-0000-0000-00000000f601') as id;

select is(
  (select count(*)::int from public.bank_statement_lines
    where import_run_id = (select id from t_old) and bank_code is null),
  2,
  'rows without bank_code still import, with no code'
);

-- The same file with its code: one line is filled, one new line is inserted.
create temporary table t_fill as
  select public.commit_import_run(
    'bank_statement', 'macro.csv', repeat('3', 64), '{}'::jsonb, 2, 0, 0,
    jsonb_build_array(
      jsonb_build_object('account_id', '00000000-0000-0000-0000-00000000fb01', 'line_date', '2026-11-05',
        'description', 'DBCR 25413 S/CR TASA GRAL', 'amount', -2007.04, 'balance', 3063436.38,
        'reference', '1953630435', 'source_hash', repeat('d', 64), 'line_no', 2,
        'bank_code', '1685', 'fill_only', true),
      jsonb_build_object('account_id', '00000000-0000-0000-0000-00000000fb01', 'line_date', '2026-11-05',
        'description', 'TEF DATANET PR GRANJA LOS ALMENDR 30719236584', 'amount', 334506.56,
        'balance', 3069818.10, 'reference', '33411571', 'source_hash', repeat('f', 64), 'line_no', 5,
        'bank_code', '2027')
    ),
    '00000000-0000-0000-0000-00000000f601') as id;

select is(
  (select bank_code from public.bank_statement_lines where source_hash = repeat('d', 64)),
  '1685',
  'a fill row writes the code of the line already loaded'
);

select is(
  (select bank_code from public.bank_statement_lines where source_hash = repeat('f', 64)),
  '2027',
  'a new row is inserted with its code'
);

select results_eq(
  $$select inserted_rows, filled_rows, skipped_rows from public.import_runs
     where id = (select id from t_fill)$$,
  $$values (1, 1, 0)$$,
  'the run counts one inserted and one filled line, none skipped'
);

-- Filling again: the code is already there, nothing changes.
create temporary table t_refill as
  select public.commit_import_run(
    'bank_statement', 'macro.csv', repeat('3', 64), '{}'::jsonb, 1, 0, 0,
    jsonb_build_array(
      jsonb_build_object('account_id', '00000000-0000-0000-0000-00000000fb01', 'line_date', '2026-11-05',
        'description', 'DBCR 25413 S/CR TASA GRAL', 'amount', -2007.04, 'balance', 3063436.38,
        'reference', '1953630435', 'source_hash', repeat('d', 64), 'line_no', 2,
        'bank_code', '9999', 'fill_only', true)
    ),
    '00000000-0000-0000-0000-00000000f601') as id;

select results_eq(
  $$select inserted_rows, filled_rows, skipped_rows from public.import_runs
     where id = (select id from t_refill)$$,
  $$values (0, 0, 1)$$,
  'a fill over a line that has its code is skipped'
);

select is(
  (select bank_code from public.bank_statement_lines where source_hash = repeat('d', 64)),
  '1685',
  'the code set first is kept'
);

select throws_ok(
  $$update public.bank_statement_lines set bank_code = '0000' where source_hash = repeat('d', 64)$$,
  '55006',
  null,
  'a line''s bank code never changes once set'
);

select * from finish();
rollback;
