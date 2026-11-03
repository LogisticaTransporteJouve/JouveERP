-- Audit w2-s2 F5: once an account has movements its currency, type and
-- opening balance are frozen; its name and notes stay editable, and an
-- account with no movements can still change all of them. One transaction,
-- rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(8);

insert into public.accounts (id, name, type, currency, opening_balance) values
  ('00000000-0000-0000-0000-00000000a111', 'Banco con movimientos', 'bank', 'ARS', 100),
  ('00000000-0000-0000-0000-00000000a112', 'Cartera con cheque', 'checks', 'ARS', 0),
  ('00000000-0000-0000-0000-00000000a113', 'Banco nuevo', 'bank', 'ARS', 0);

insert into public.transactions
  (account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description)
values
  ('00000000-0000-0000-0000-00000000a111', 'jouve_internal', 'income', 50, 'ARS',
   current_date, date_trunc('month', current_date)::date, 'Movimiento');

insert into public.checks
  (kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
   source_kind, cartera_account_id, channel_id)
values
  ('fisico', 'FRZ-1', 'Banco X', 'Firmante', current_date, current_date, 10, 'ARS',
   'manual', '00000000-0000-0000-0000-00000000a112', 'jouve_internal');

select throws_ok(
  $$update public.accounts set opening_balance = 500 where id = '00000000-0000-0000-0000-00000000a111'$$,
  '23514',
  'No se puede cambiar el saldo inicial de una cuenta con movimientos: usá "Ajustar saldo", que lo corrige con fecha',
  'the opening balance of an account with movements is frozen'
);

select throws_ok(
  $$update public.accounts set type = 'cash' where id = '00000000-0000-0000-0000-00000000a111'$$,
  '23514',
  'No se puede cambiar el tipo de una cuenta con movimientos: creá otra cuenta del tipo que necesitás',
  'so is its type'
);

select throws_ok(
  $$update public.accounts set currency = 'USD' where id = '00000000-0000-0000-0000-00000000a111'$$,
  '23514',
  'No se puede cambiar la moneda de una cuenta con movimientos: creá otra cuenta en USD',
  'and its currency'
);

select throws_ok(
  $$update public.accounts set type = 'bank' where id = '00000000-0000-0000-0000-00000000a112'$$,
  '23514',
  'No se puede cambiar el tipo de una cuenta con movimientos: creá otra cuenta del tipo que necesitás',
  'a cartera holding a check counts as having movements'
);

select lives_ok(
  $$update public.accounts
       set name = 'Banco renombrado', notes = 'nota', opening_balance = 100, type = 'bank', currency = 'ARS'
     where id = '00000000-0000-0000-0000-00000000a111'$$,
  'name and notes stay editable, and resending the same values passes'
);

select lives_ok(
  $$update public.accounts set type = 'cash', currency = 'USD', opening_balance = 30
     where id = '00000000-0000-0000-0000-00000000a113'$$,
  'an account with no movements changes freely'
);

select ok(
  public.account_has_movements('00000000-0000-0000-0000-00000000a111')
    and not public.account_has_movements('00000000-0000-0000-0000-00000000a113'),
  'account_has_movements tells them apart'
);

select ok(
  not has_function_privilege('authenticated', 'public.account_has_movements(uuid)', 'execute'),
  'account_has_movements is not callable by authenticated'
);

select * from finish();
rollback;
