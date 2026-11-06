-- accounting_settings: one row, October by default, read by the accounting
-- roles and written by owner and admin only. One transaction, rolled back.

begin;

select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005a1', 'admin@settings.test'),
  ('00000000-0000-0000-0000-0000000005a2', 'finance@settings.test'),
  ('00000000-0000-0000-0000-0000000005a3', 'ops@settings.test'),
  ('00000000-0000-0000-0000-0000000005a4', 'reader@settings.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000005a1', 'admin'),
  ('00000000-0000-0000-0000-0000000005a2', 'finance'),
  ('00000000-0000-0000-0000-0000000005a3', 'operations'),
  ('00000000-0000-0000-0000-0000000005a4', 'fiscal_reader');

select is(
  (select fiscal_year_start_month::int from public.accounting_settings),
  10,
  'the fiscal year starts in October by default'
);

select throws_ok(
  $$insert into public.accounting_settings (id) values (false)$$,
  '23514',
  null,
  'a second row is refused'
);

select throws_ok(
  $$update public.accounting_settings set fiscal_year_start_month = 13$$,
  '23514',
  null,
  'a month outside 1-12 is refused'
);

set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000005a4","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.accounting_settings),
  1,
  'the external accountant reads the settings'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000005a3","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.accounting_settings),
  0,
  'operations does not read the settings'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000005a2","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.accounting_settings),
  1,
  'finance reads the settings'
);
update public.accounting_settings set fiscal_year_start_month = 1;
select is(
  (select fiscal_year_start_month::int from public.accounting_settings),
  10,
  'finance cannot change the start month'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000005a1","role":"authenticated"}', true);
update public.accounting_settings set fiscal_year_start_month = 7;
select is(
  (select fiscal_year_start_month::int from public.accounting_settings),
  7,
  'admin changes the start month'
);

select throws_ok(
  $$insert into public.accounting_settings (id) values (true)$$,
  '42501',
  null,
  'nobody inserts through the API'
);

reset role;

select * from finish();
rollback;
