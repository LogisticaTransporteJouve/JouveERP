-- Conciliación, several lines against one movement (20261104010100): the
-- lines of a split deposit match the movement when they add up to it; a
-- retry is a no-op; a reconciliation is never many lines against many
-- movements; unmatching one line frees the whole reconciliation. One
-- transaction, rolled back.

begin;

select plan(12);

-- The posting trigger checks the caller like the app's service client.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f701', 'owner@split.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-00000000f701', 'owner');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000fb01', 'Banco Partido', 'bank', 'ARS');

select ok(
  not has_function_privilege('authenticated', 'public.match_bank_statement_lines(uuid[], uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.match_bank_statement_lines(uuid[], uuid, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.match_bank_statement_lines(uuid[], uuid, uuid)', 'execute'),
  'only the service role matches several lines'
);

create temporary table t_stmt as
  select public.commit_import_run(
    'bank_statement', 'partido.csv', repeat('d', 64), '{}'::jsonb, 3, 0, 0,
    jsonb_build_array(
      jsonb_build_object('account_id', '00000000-0000-0000-0000-00000000fb01', 'line_date', '2026-10-05',
        'description', 'Depósito parte 1', 'amount', 600, 'balance', null, 'reference', null,
        'source_hash', repeat('e', 64), 'line_no', 2),
      jsonb_build_object('account_id', '00000000-0000-0000-0000-00000000fb01', 'line_date', '2026-10-05',
        'description', 'Depósito parte 2', 'amount', 400, 'balance', null, 'reference', null,
        'source_hash', repeat('f', 64), 'line_no', 3),
      jsonb_build_object('account_id', '00000000-0000-0000-0000-00000000fb01', 'line_date', '2026-10-06',
        'description', 'Otro crédito', 'amount', 50, 'balance', null, 'reference', null,
        'source_hash', repeat('0', 64), 'line_no', 4)
    ),
    '00000000-0000-0000-0000-00000000f701') as id;

create temporary table t_line as
  select id, description from public.bank_statement_lines
   where import_run_id = (select id from t_stmt);

insert into public.transactions
  (id, account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description)
values
  ('00000000-0000-0000-0000-00000000fd01', '00000000-0000-0000-0000-00000000fb01', 'jouve_fiscal',
   'income', 1000, 'ARS', '2026-10-05', '2026-10-01', 'Depósito del cliente'),
  ('00000000-0000-0000-0000-00000000fd02', '00000000-0000-0000-0000-00000000fb01', 'jouve_fiscal',
   'income', 70, 'ARS', '2026-10-06', '2026-10-01', 'Cobro chico'),
  ('00000000-0000-0000-0000-00000000fd03', '00000000-0000-0000-0000-00000000fb01', 'jouve_fiscal',
   'income', 50, 'ARS', '2026-10-06', '2026-10-01', 'Cobro de 50');

select throws_ok(
  $$select public.match_bank_statement_lines(
      array[(select id from t_line where description = 'Otro crédito')],
      '00000000-0000-0000-0000-00000000fd02', '00000000-0000-0000-0000-00000000f701')$$,
  '22023',
  null,
  'lines that do not add up to the movement are refused'
);

select lives_ok(
  $$select public.match_bank_statement_lines(
      array(select id from t_line where description like 'Depósito parte%'),
      '00000000-0000-0000-0000-00000000fd01', '00000000-0000-0000-0000-00000000f701')$$,
  'two lines match the movement they add up to'
);

select is(
  (select count(*)::int from public.bank_statement_lines l
     join t_line t on t.id = l.id
    where l.status = 'matched'),
  2,
  'both lines are reconciled'
);

select lives_ok(
  $$select public.match_bank_statement_lines(
      array(select id from t_line where description like 'Depósito parte%'),
      '00000000-0000-0000-0000-00000000fd01', '00000000-0000-0000-0000-00000000f701')$$,
  'repeating the same match is a no-op'
);

select is(
  (select count(*)::int from public.bank_statement_matches
    where transaction_id = '00000000-0000-0000-0000-00000000fd01'),
  2,
  'the retry adds no match'
);

select throws_ok(
  $$select public.match_bank_statement_line(
      (select id from t_line where description = 'Otro crédito'),
      array['00000000-0000-0000-0000-00000000fd01']::uuid[],
      '00000000-0000-0000-0000-00000000f701')$$,
  '55006',
  null,
  'a movement matched with several lines takes no other line'
);

select throws_ok(
  $$update public.transactions set amount = 999 where id = '00000000-0000-0000-0000-00000000fd01'$$,
  '55006',
  null,
  'the split movement is locked while reconciled'
);

select lives_ok(
  $$select public.match_bank_statement_line(
      (select id from t_line where description = 'Otro crédito'),
      array['00000000-0000-0000-0000-00000000fd03']::uuid[],
      '00000000-0000-0000-0000-00000000f701')$$,
  'a one-to-one match next to it'
);

select throws_ok(
  $$insert into public.bank_statement_matches (line_id, transaction_id)
    values ((select id from t_line where description = 'Depósito parte 1'),
            '00000000-0000-0000-0000-00000000fd03')$$,
  '55006',
  null,
  'a reconciliation is never several lines against several movements'
);

select lives_ok(
  $$select public.unmatch_bank_statement_line(
      (select id from t_line where description = 'Depósito parte 1'),
      '00000000-0000-0000-0000-00000000f701')$$,
  'unmatching one line of the split movement'
);

select results_eq(
  $$select l.status, count(m.id)::int
      from public.bank_statement_lines l
      join t_line t on t.id = l.id
      left join public.bank_statement_matches m on m.line_id = l.id
     where t.description like 'Depósito parte%'
     group by l.status$$,
  $$values ('open'::text, 0)$$,
  'frees every line of its reconciliation'
);

select * from finish();
rollback;
