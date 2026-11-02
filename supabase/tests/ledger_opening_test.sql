-- get_ledger: the running balance of a date range starts from the balance
-- before it (get_ledger_opening). One transaction, rolled back.

begin;

select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000086f1', 'finance@ledger-opening.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000086f1', 'finance');

insert into public.chart_of_accounts (id, code, name, level, account_type) values
  ('00000000-0000-0000-0000-0000000086a1', '93', 'Mayor prueba', 1, 'activo'),
  ('00000000-0000-0000-0000-0000000086a2', '94', 'Contrapartida prueba', 1, 'pasivo');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000086f1","role":"authenticated"}', true);

-- Before the range: +1000 and −300 → opening 700. In the range: +200, −50.
do $$
begin
perform public.create_manual_journal_entry('2026-09-10', 'Antes 1',
  '[{"account_id":"00000000-0000-0000-0000-0000000086a1","debit":1000,"credit":0},
    {"account_id":"00000000-0000-0000-0000-0000000086a2","debit":0,"credit":1000}]'::jsonb, null);
perform public.create_manual_journal_entry('2026-09-20', 'Antes 2',
  '[{"account_id":"00000000-0000-0000-0000-0000000086a1","debit":0,"credit":300},
    {"account_id":"00000000-0000-0000-0000-0000000086a2","debit":300,"credit":0}]'::jsonb, null);
perform public.create_manual_journal_entry('2026-10-05', 'Rango 1',
  '[{"account_id":"00000000-0000-0000-0000-0000000086a1","debit":200,"credit":0},
    {"account_id":"00000000-0000-0000-0000-0000000086a2","debit":0,"credit":200}]'::jsonb, null);
perform public.create_manual_journal_entry('2026-10-15', 'Rango 2',
  '[{"account_id":"00000000-0000-0000-0000-0000000086a1","debit":0,"credit":50},
    {"account_id":"00000000-0000-0000-0000-0000000086a2","debit":50,"credit":0}]'::jsonb, null);
end;
$$;

select is(
  public.get_ledger_opening('00000000-0000-0000-0000-0000000086a1', '2026-10-01'),
  700::numeric,
  'the opening is the balance before the range');

select results_eq(
  $$select description, running from public.get_ledger(
      '00000000-0000-0000-0000-0000000086a1', '2026-10-01', '2026-10-31')$$,
  $$values ('Rango 1'::text, 900::numeric), ('Rango 2'::text, 850::numeric)$$,
  'the running balance of a range starts from the opening');

select results_eq(
  $$select running from public.get_ledger('00000000-0000-0000-0000-0000000086a1')$$,
  $$values (1000::numeric), (700::numeric), (900::numeric), (850::numeric)$$,
  'without a from date the running balance starts at 0');

select is(
  public.get_ledger_opening('00000000-0000-0000-0000-0000000086a1', null),
  0::numeric,
  'no from date, no opening');

select is(
  public.get_ledger_opening('00000000-0000-0000-0000-0000000086a1', '2026-11-01'),
  850::numeric,
  'a range after every movement opens at the closing balance');

reset role;

select ok(
  has_function_privilege('authenticated', 'public.get_ledger_opening(uuid, date)', 'execute')
  and not has_function_privilege('anon', 'public.get_ledger_opening(uuid, date)', 'execute')
  and not has_function_privilege('anon', 'public.get_ledger(uuid, date, date)', 'execute'),
  'authenticated (not anon) can read the ledger');

select * from finish();
rollback;
