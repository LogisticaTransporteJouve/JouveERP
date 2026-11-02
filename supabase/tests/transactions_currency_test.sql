-- Roadmap 1.3 (20261102240000): a movement carries its account's currency,
-- and a USD movement posts its pesos at the day's rate, or nothing (listed as
-- 'sin_cotizacion') when there is no rate. One transaction, rolled back.

begin;

select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000013f1', 'finance@transactions-currency.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000013f1', 'finance');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000a131', 'Banco Pesos Moneda', 'bank', 'ARS'),
  ('00000000-0000-0000-0000-00000000a132', 'Banco Dólares Moneda', 'bank', 'USD');
-- No seed rate is that old: 1990 has none, 1991 has this one.
insert into public.exchange_rates (currency, rate_date, rate, source) values
  ('USD', '1991-01-02', 1000, 'manual');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000013f1","role":"authenticated"}', true);

select throws_ok(
  $$insert into public.transactions
      (account_id, channel_id, kind, amount, currency, transaction_date, accrual_month)
    values ('00000000-0000-0000-0000-00000000a131', 'jouve_fiscal', 'expense', 10, 'USD',
            '1991-02-10', '1991-02-01')$$,
  '23514',
  null,
  'a USD movement cannot go to a peso account'
);

select lives_ok(
  $$insert into public.transactions
      (id, account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description)
    values
      ('00000000-0000-0000-0000-0000000013e1', '00000000-0000-0000-0000-00000000a132', 'jouve_fiscal',
       'expense', 10.25, 'USD', '1991-02-10', '1991-02-01', 'Gasto USD'),
      ('00000000-0000-0000-0000-0000000013e2', '00000000-0000-0000-0000-00000000a132', 'jouve_fiscal',
       'expense', 7, 'USD', '1990-06-01', '1990-06-01', 'Gasto USD sin cotización')$$,
  'a USD movement goes to a USD account'
);

select throws_ok(
  $$update public.transactions set currency = 'ARS'
     where id = '00000000-0000-0000-0000-0000000013e1'$$,
  '23514',
  null,
  'its currency cannot drift from the account''s'
);

set constraints all immediate;

select results_eq(
  $$select coa.system_role::text, l.debit, l.credit
      from public.journal_entries je
      join public.journal_entry_lines l on l.journal_entry_id = je.id
      join public.chart_of_accounts coa on coa.id = l.chart_of_accounts_id
     where je.source_table = 'transactions'
       and je.source_id = '00000000-0000-0000-0000-0000000013e1'
     order by l.debit desc$$,
  $$values ('gastos', 10250.00::numeric, 0::numeric), ('banco', 0::numeric, 10250.00::numeric)$$,
  'a USD movement posts its pesos at the rate of its date'
);

select is(
  (select count(*)::int from public.journal_entries
    where source_table = 'transactions'
      and source_id = '00000000-0000-0000-0000-0000000013e2'),
  0,
  'without a rate it posts nothing'
);

reset role;

select is(
  (select status from public.journal_missing_entries()
    where source_id = '00000000-0000-0000-0000-0000000013e2'),
  'sin_cotizacion',
  'and is listed as missing its rate'
);

select is(
  (select count(*)::int from public.journal_missing_entries()
    where source_id = '00000000-0000-0000-0000-0000000013e1'),
  0,
  'the converted one is in order'
);

select throws_ok(
  $$update public.accounts set currency = 'ARS'
     where id = '00000000-0000-0000-0000-00000000a132'$$,
  '23514',
  null,
  'an account with movements keeps its currency'
);

select * from finish();
rollback;
