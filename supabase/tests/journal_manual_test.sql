-- create_manual_journal_entry: channel NULL or an active fiscal channel (D1),
-- run as a finance user; the journal is not writable directly. One
-- transaction, rolled back.

begin;

select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f2', 'finance@journal-manual.test'),
  ('00000000-0000-0000-0000-0000000000f3', 'ops@journal-manual.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000000f2', 'finance'),
  ('00000000-0000-0000-0000-0000000000f3', 'operations');

insert into public.chart_of_accounts (id, code, name, level, account_type) values
  ('00000000-0000-0000-0000-00000000ac01', '97', 'Prueba debe', 1, 'activo'),
  ('00000000-0000-0000-0000-00000000ac02', '98', 'Prueba haber', 1, 'pasivo');

insert into public.invoicing_channels (id, business_unit_id, division, name, is_fiscal, is_active)
values ('test_fiscal_off', 'dz_sons', 'jouve', 'Fiscal inactivo', true, false);

create temp table lines on commit drop as
select '[{"account_id":"00000000-0000-0000-0000-00000000ac01","debit":100,"credit":0},
         {"account_id":"00000000-0000-0000-0000-00000000ac02","debit":0,"credit":100}]'::jsonb as l;
grant select on lines to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);

select throws_ok(
  $$select public.create_manual_journal_entry('2026-10-15', 'Interno', (select l from lines), 'jouve_internal')$$,
  '23514',
  'Un asiento manual va sin canal o en un canal fiscal activo',
  'an internal channel is refused'
);

select throws_ok(
  $$select public.create_manual_journal_entry('2026-10-15', 'Inactivo', (select l from lines), 'test_fiscal_off')$$,
  '23514',
  null,
  'an inactive fiscal channel is refused'
);

select lives_ok(
  $$select public.create_manual_journal_entry('2026-10-15', 'Sin canal', (select l from lines), null)$$,
  'a NULL channel is accepted'
);

select lives_ok(
  $$select public.create_manual_journal_entry('2026-10-15', 'Fiscal', (select l from lines), 'jouve_fiscal')$$,
  'an active fiscal channel is accepted'
);

reset role;

select results_eq(
  $$select accrual_period, source_table, source_id, created_by, channel_id
      from public.journal_entries where description = 'Fiscal'$$,
  $$values ('2026-10'::text, null::text, null::uuid,
            '00000000-0000-0000-0000-0000000000f2'::uuid, 'jouve_fiscal'::text)$$,
  'the entry has the accrual period of its date, no source and the caller as author'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);

select throws_ok(
  $$select public.create_manual_journal_entry('2026-10-15', 'Rol',
      '[{"system_role":"caja","debit":100,"credit":0},
        {"account_id":"00000000-0000-0000-0000-00000000ac02","debit":0,"credit":100}]'::jsonb, null)$$,
  '22023',
  'Cada línea del asiento necesita una cuenta',
  'a line without account_id (system_role) is refused'
);

select throws_ok(
  $$insert into public.journal_entries (entry_date, accrual_period, description)
    values ('2026-10-15', '2026-10', 'Directo')$$,
  '42501',
  null,
  'a direct insert into journal_entries is denied'
);

select is(
  (select count(*)::int from public.journal_entries where description = 'Directo'),
  0,
  'nothing was inserted directly'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f3","role":"authenticated"}', true);

select throws_ok(
  $$select public.create_manual_journal_entry('2026-10-15', 'Ops', (select l from lines), null)$$,
  '42501',
  null,
  'a role without accounting:write is refused'
);

reset role;

select ok(
  has_function_privilege('authenticated', 'public.create_manual_journal_entry(date, text, jsonb, text)', 'execute')
  and not has_function_privilege('anon', 'public.create_manual_journal_entry(date, text, jsonb, text)', 'execute'),
  'authenticated (not anon) can run create_manual_journal_entry'
);

select ok(
  not has_function_privilege('authenticated', 'public.journal_non_fiscal_entries()', 'execute'),
  'authenticated cannot run journal_non_fiscal_entries'
);

select ok(
  not has_table_privilege('authenticated', 'public.journal_entries', 'truncate')
  and not has_table_privilege('authenticated', 'public.journal_entry_lines', 'truncate')
  and not has_table_privilege('anon', 'public.journal_entries', 'truncate'),
  'anon and authenticated cannot truncate the journal'
);

select * from finish();

rollback;
