-- Préstamo en dólares pagado en pesos y préstamo sin vencimiento
-- (20261112140000, 20261112140100): a USD cuota paid from a peso account
-- stores its rate and posts at it; same-currency cuotas post as before; an
-- open-ended loan keeps 3 upcoming interest cuotas, returns capital only
-- with «Devolución de capital», and only the service role converts a loan or
-- links a cuota paid before it was loaded. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(46);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000001410f1', 'finance@loan-fx.test'),
  ('00000000-0000-0000-0000-0000001410f2', 'owner@loan-fx.test'),
  ('00000000-0000-0000-0000-0000001410f3', 'warehouse@loan-fx.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000001410f1', 'finance'),
  ('00000000-0000-0000-0000-0000001410f2', 'owner'),
  ('00000000-0000-0000-0000-0000001410f3', 'warehouse');

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000001410a1', 'Banco pesos préstamo USD', 'bank', 'ARS'),
  ('00000000-0000-0000-0000-0000001410a2', 'Banco dólares préstamo USD', 'bank', 'USD');

-- No seed rate is that old: April 1992 takes 1400, May 1992 takes 1555.
insert into public.exchange_rates (currency, rate_date, rate, source) values
  ('USD', '1992-04-01', 1400, 'manual'),
  ('USD', '1992-05-01', 1555, 'manual');

create function pg_temp.side(p_tx uuid, p_role text, p_side text) returns numeric
language sql as $$
  select coalesce(sum(case when p_side = 'debit' then l.debit else l.credit end), 0)
    from public.journal_entries je
    join public.journal_entry_lines l on l.journal_entry_id = je.id
    join public.chart_of_accounts c on c.id = l.chart_of_accounts_id
   where je.source_table = 'transactions' and je.source_id = p_tx and not je.is_reversal
     and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = je.id)
     and c.system_role::text = p_role
$$;

create function pg_temp.entries(p_tx uuid) returns bigint
language sql as $$
  select count(*) from public.journal_entries je
   where je.source_table = 'transactions' and je.source_id = p_tx and not je.is_reversal
     and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = je.id)
$$;

-- (a) Same currency: an ARS split cuota with an IVA perception posts as before.

insert into public.loans (id, channel_id, currency, description, first_due_date, installments_count, kind, principal)
values
  ('00000000-0000-0000-0000-0000001410b1', 'jouve_fiscal', 'ARS', 'Préstamo pesos', '1992-05-04', 1, 'prestamo', 1000);
insert into public.loan_installments (id, loan_id, number, due_date, amount,
  capital_amount, interest_amount, iva_amount, perception_amount, iva_perception_amount, other_charges_amount)
values
  ('00000000-0000-0000-0000-0000001410d1', '00000000-0000-0000-0000-0000001410b1', 1, '1992-05-04', 1300,
   1000, 100, 21, 179, 100, 0);

create temp table t_ars on commit drop as
  select public.pay_loan_installment('00000000-0000-0000-0000-0000001410d1', '1992-05-04',
    '00000000-0000-0000-0000-0000001410a1', 1300) as tx_id;

select is(pg_temp.side((select tx_id from t_ars), 'intereses_pagados', 'debit'), 100::numeric,
  'same currency: the interest posts as before');
select is(pg_temp.side((select tx_id from t_ars), 'percepciones_iva_pagadas', 'debit'), 100::numeric,
  'same currency: the IVA perception posts as before');
select is(pg_temp.side((select tx_id from t_ars), 'percepciones_iibb_pagadas', 'debit'), 79::numeric,
  'same currency: the IIBB perception posts as before');
select is((select paid_rate from public.loan_installments where id = '00000000-0000-0000-0000-0000001410d1'),
  null::numeric, 'same currency: no rate is stored');

-- (b) A fiscal USD loan disbursed at 1400; a cuota of 0 capital / 400
-- interest and one of 100 capital paid from pesos at 1555.

insert into public.loans (id, channel_id, currency, description, first_due_date, installments_count, kind, principal)
values
  ('00000000-0000-0000-0000-0000001410b2', 'jouve_fiscal', 'USD', 'Préstamo dólares fiscal', '1992-05-04', 3, 'prestamo', 1000);
insert into public.loan_installments (id, loan_id, number, due_date, amount,
  capital_amount, interest_amount, iva_amount, perception_amount, other_charges_amount)
values
  ('00000000-0000-0000-0000-0000001410d2', '00000000-0000-0000-0000-0000001410b2', 1, '1992-05-04', 400, 0, 400, 0, 0, 0),
  ('00000000-0000-0000-0000-0000001410d3', '00000000-0000-0000-0000-0000001410b2', 2, '1992-05-04', 100, 100, 0, 0, 0, 0),
  ('00000000-0000-0000-0000-0000001410d4', '00000000-0000-0000-0000-0000001410b2', 3, '1992-05-04', 100, 100, 0, 0, 0, 0);

create temp table t_disb on commit drop as
  select public.record_loan_disbursement('00000000-0000-0000-0000-0000001410b2',
    '00000000-0000-0000-0000-0000001410a2', '1992-04-02', null) as id;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001410f1","role":"authenticated"}', true);

create temp table t_usd on commit drop as
  select public.pay_loan_installment('00000000-0000-0000-0000-0000001410d2', '1992-05-04',
    '00000000-0000-0000-0000-0000001410a1', 400, 622000) as tx_id;
create temp table t_usd_cap on commit drop as
  select public.pay_loan_installment('00000000-0000-0000-0000-0000001410d3', '1992-05-04',
    '00000000-0000-0000-0000-0000001410a1', 100, 155500) as tx_id;

-- (c) (e) (f) refusals, as finance and warehouse.
select throws_ok(
  $$select public.pay_loan_installment('00000000-0000-0000-0000-0000001410d4', '1992-05-04',
      '00000000-0000-0000-0000-0000001410a1', 100, 100000)$$,
  '23514', null, 'a rate more than 20 % away from the official one is refused');
select throws_ok(
  $$select public.pay_loan_installment('00000000-0000-0000-0000-0000001410d4', '1992-05-04',
      '00000000-0000-0000-0000-0000001410a1', 50, 77750)$$,
  '23514', null, 'a USD cuota from a peso account is paid whole');
select throws_ok(
  $$select public.pay_loan_installment('00000000-0000-0000-0000-0000001410d4', '1992-05-04',
      '00000000-0000-0000-0000-0000001410a2', 100, 155500)$$,
  '22023', null, 'a same-currency payment carries no amount in another currency');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001410f3","role":"authenticated"}', true);
select throws_ok(
  $$select public.pay_loan_installment('00000000-0000-0000-0000-0000001410d4', '1992-05-04',
      '00000000-0000-0000-0000-0000001410a1', 100, 155500)$$,
  '42501', null, 'warehouse cannot pay a cuota');
select throws_ok(
  $$select public.adopt_loan_installment_payment_core('00000000-0000-0000-0000-0000001410d4',
      '00000000-0000-0000-0000-0000001410d4', false)$$,
  '42501', null, 'authenticated cannot execute the adopt core');

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

set constraints all immediate;
set constraints all deferred;

select is((select (t.amount, t.currency)::text from public.transactions t where t.id = (select tx_id from t_usd)),
  '(622000.00,ARS)', 'the movement is in pesos for what left the account');
select is((select (i.paid_amount, i.paid_amount_ars, i.paid_rate)::text from public.loan_installments i
            where i.id = '00000000-0000-0000-0000-0000001410d2'),
  '(400.00,622000.00,1555.000000)', 'the cuota stores 400 / 622.000 / 1555');
select is(pg_temp.side((select tx_id from t_usd), 'intereses_pagados', 'debit'), 622000::numeric,
  'fiscal: the interest is 622.000 at the cuota''s rate');
select is(pg_temp.side((select tx_id from t_usd), 'prestamos', 'debit'), 0::numeric,
  'fiscal: no capital on an interest-only cuota');
select is(pg_temp.side((select tx_id from t_usd), 'banco', 'credit')
          + pg_temp.side((select tx_id from t_usd), 'caja', 'credit'),
  622000::numeric, 'fiscal: the bank is credited 622.000');

select is(pg_temp.side((select tx_id from t_usd_cap), 'prestamos', 'debit'), 140000::numeric,
  'fiscal: the capital takes prestamos off at the disbursement''s rate (1400)');
select is(pg_temp.side((select tx_id from t_usd_cap), 'diferencia_cambio', 'debit'), 15500::numeric,
  'fiscal: the rate difference is a loss');
select is(
  (select sum(l.debit) - sum(l.credit) from public.journal_entries je
     join public.journal_entry_lines l on l.journal_entry_id = je.id
    where je.source_table = 'transactions' and je.source_id = (select tx_id from t_usd_cap)
      and not je.is_reversal),
  0::numeric, 'fiscal: the entry balances');

-- (c) ARS loan from a USD account.
insert into public.loans (id, channel_id, currency, description, first_due_date, installments_count, kind, principal)
values
  ('00000000-0000-0000-0000-0000001410b3', 'jouve_fiscal', 'ARS', 'Préstamo pesos 2', '1992-05-04', 1, 'prestamo', 100);
insert into public.loan_installments (id, loan_id, number, due_date, amount) values
  ('00000000-0000-0000-0000-0000001410d5', '00000000-0000-0000-0000-0000001410b3', 1, '1992-05-04', 100);
select throws_ok(
  $$select public.pay_loan_installment('00000000-0000-0000-0000-0000001410d5', '1992-05-04',
      '00000000-0000-0000-0000-0000001410a2', 100, null)$$,
  '23514', 'Una cuota en pesos se paga desde una cuenta en pesos', 'an ARS cuota from a USD account is refused');

-- (b) internal and (d) adopt: an internal USD loan; its interest from an
-- existing peso expense.

insert into public.loans (id, channel_id, currency, description, first_due_date, installments_count, kind, principal)
values
  ('00000000-0000-0000-0000-0000001410b4', 'jouve_internal', 'USD', 'Préstamo dólares interno', '1992-05-04', 2, 'prestamo', 40000);
insert into public.loan_installments (id, loan_id, number, due_date, amount,
  capital_amount, interest_amount, iva_amount, perception_amount, other_charges_amount)
values
  ('00000000-0000-0000-0000-0000001410d6', '00000000-0000-0000-0000-0000001410b4', 1, '1992-05-04', 400, 0, 400, 0, 0, 0),
  ('00000000-0000-0000-0000-0000001410d7', '00000000-0000-0000-0000-0000001410b4', 2, '1992-06-04', 400, 0, 400, 0, 0, 0);

insert into public.transactions (id, account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description)
values
  ('00000000-0000-0000-0000-0000001410e1', '00000000-0000-0000-0000-0000001410a1', 'jouve_internal', 'expense',
   622000, 'ARS', '1992-05-04', '1992-05-01', 'Intereses préstamo dólares');

select lives_ok(
  $$select public.adopt_loan_installment_payment('00000000-0000-0000-0000-0000001410d6',
      '00000000-0000-0000-0000-0000001410e1')$$,
  'a peso expense is adopted for a USD cuota');
select is((select (i.paid_amount, i.paid_amount_ars, i.paid_rate)::text from public.loan_installments i
            where i.id = '00000000-0000-0000-0000-0000001410d6'),
  '(400.00,622000.00,1555.000000)', 'the adopted cuota stores 400 / 622.000 / 1555');
select is(pg_temp.entries('00000000-0000-0000-0000-0000001410e1'), 0::bigint,
  'internal: no journal entry');
select is(
  (select sum(amount_ars) from public.management_pnl_lines('1992-05-01', '1992-05-31', 'accrual')
    where source_id = '00000000-0000-0000-0000-0000001410e1' and bucket <> 'loan_principal'),
  -622000::numeric, 'internal: Gestión shows 622.000 as interest');
select is(
  (select coalesce(sum(amount_ars), 0) from public.management_pnl_lines('1992-05-01', '1992-05-31', 'accrual')
    where source_id = '00000000-0000-0000-0000-0000001410e1' and bucket = 'loan_principal'),
  0::numeric, 'internal: none of it is loan principal');

-- I2: open-ended ---------------------------------------------------------------------

create temp table t_open on commit drop as
  select public.create_loan_core(
    jsonb_build_object('kind', 'prestamo', 'description', 'Sin vencimiento', 'lender', 'Prestamista',
      'principal', 40000, 'currency', 'USD', 'channel_id', 'jouve_internal',
      'installments_count', 1, 'first_due_date', current_date + 5,
      'is_open_ended', true, 'monthly_rate', 1),
    null, null, null) as id;
grant select on t_open to authenticated;

select is((select count(*) from public.loan_installments i
            where i.loan_id = (select id from t_open) and i.status = 'pendiente' and i.due_date >= current_date),
  3::bigint, 'an open-ended loan starts with 3 upcoming cuotas');
select is((select min(amount) from public.loan_installments i where i.loan_id = (select id from t_open)),
  400::numeric, 'each is 1 % of 40.000');
select is(public.extend_open_ended_loan((select id from t_open)), 0,
  'extending again adds nothing');
select is((select installments_count from public.loans where id = (select id from t_open)), 3,
  'installments_count follows the cuotas');
select is(
  (select count(*) from public.open_ended_loan_projection(
     ((select max(due_date) from public.loan_installments where loan_id = (select id from t_open))
       + interval '6 months')::date)
    where loan_id = (select id from t_open)),
  6::bigint, 'the projection adds one cuota per month after the last generated one');
select is(
  (select sum(amount) from public.open_ended_loan_projection(
     ((select max(due_date) from public.loan_installments where loan_id = (select id from t_open))
       + interval '6 months')::date)
    where loan_id = (select id from t_open)),
  2400::numeric, 'at the interest of each month');

-- Paying a cuota keeps 3 upcoming and never closes the loan.
select lives_ok(
  $$select public.pay_loan_installment(
      (select id from public.loan_installments where loan_id = (select id from t_open) order by number limit 1),
      current_date, '00000000-0000-0000-0000-0000001410a2', 400)$$,
  'an interest cuota is paid');
select is((select count(*) from public.loan_installments i
            where i.loan_id = (select id from t_open) and i.status = 'pendiente' and i.due_date >= current_date),
  3::bigint, 'still 3 upcoming after a payment');

-- Capital repayment.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001410f3","role":"authenticated"}', true);
select throws_ok(
  $$select public.repay_loan_capital((select id from t_open), current_date,
      '00000000-0000-0000-0000-0000001410a2', 10000, null)$$,
  '42501', null, 'warehouse cannot return capital');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001410f1","role":"authenticated"}', true);
select lives_ok(
  $$select public.repay_loan_capital((select id from t_open), current_date,
      '00000000-0000-0000-0000-0000001410a2', 10000, null)$$,
  'finance returns part of the capital');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select is((select max(amount) from public.loan_installments i
            where i.loan_id = (select id from t_open) and i.status = 'pendiente' and i.kind = 'cuota'),
  300::numeric, 'the later cuotas take the interest on 30.000');
select is((select amount from public.loan_installments i
            where i.loan_id = (select id from t_open) and i.status = 'pagada' and i.kind = 'cuota'),
  400::numeric, 'a paid cuota is untouched');
select lives_ok(
  $$select public.repay_loan_capital((select id from t_open), current_date,
      '00000000-0000-0000-0000-0000001410a2', 30000, null)$$,
  'the rest of the capital comes back');
select is((select status::text from public.loans where id = (select id from t_open)), 'paid',
  'with nothing owed nor pending the loan closes');

-- I2.3: conversion and relink ------------------------------------------------------

insert into public.loans (id, channel_id, currency, description, first_due_date, installments_count, kind, principal)
values
  ('00000000-0000-0000-0000-0000001410b5', 'jouve_internal', 'USD', 'Préstamo a convertir', current_date - 40, 12, 'prestamo', 40000);
insert into public.loan_installments (id, loan_id, number, due_date, amount, status, paid_date, paid_amount, paid_outside)
select gen_random_uuid(), '00000000-0000-0000-0000-0000001410b5', n,
       (current_date - 40 + make_interval(months => n - 1))::date, 400, 'pendiente', null, null, false
  from generate_series(2, 12) n;
-- The paid-outside cuota goes through create_loan_core in the app; here it is
-- written with the guard off, as that RPC would.
alter table public.loan_installments disable trigger loan_installments_guard_payment;
insert into public.loan_installments (id, loan_id, number, due_date, amount, status, paid_date, paid_amount, paid_outside)
values ('00000000-0000-0000-0000-0000001410d8', '00000000-0000-0000-0000-0000001410b5', 1, current_date - 40, 400,
        'pagada', current_date - 40, 400, true);
alter table public.loan_installments enable trigger loan_installments_guard_payment;

insert into public.exchange_rates (currency, rate_date, rate, source)
values ('USD', current_date - 40, 1555, 'manual')
on conflict (currency, rate_date) do update set rate = excluded.rate;

insert into public.transactions (id, account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description, expense_account_id)
values
  ('00000000-0000-0000-0000-0000001410e2', '00000000-0000-0000-0000-0000001410a1', 'jouve_internal', 'expense',
   622000, 'ARS', current_date - 40, date_trunc('month', current_date - 40)::date, 'Intereses préstamo a convertir', null);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001410f2","role":"authenticated"}', true);
select throws_ok(
  $$select public.convert_loan_to_open_ended('00000000-0000-0000-0000-0000001410b5', 1)$$,
  '42501', null, 'the owner cannot convert a loan');
select throws_ok(
  $$select public.relink_loan_installment_payment('00000000-0000-0000-0000-0000001410d8',
      '00000000-0000-0000-0000-0000001410e2')$$,
  '42501', null, 'the owner cannot relink a cuota');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001410f1","role":"authenticated"}', true);
select throws_ok(
  $$select public.relink_loan_installment_payment('00000000-0000-0000-0000-0000001410d8',
      '00000000-0000-0000-0000-0000001410e2')$$,
  '42501', null, 'finance cannot relink a cuota');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select throws_ok(
  $$select public.relink_loan_installment_payment('00000000-0000-0000-0000-0000001410d2',
      '00000000-0000-0000-0000-0000001410e2')$$,
  '23514', null, 'relink refuses a cuota not paid before the loan was loaded');

update public.loans set channel_id = 'jouve_fiscal' where id = '00000000-0000-0000-0000-0000001410b5';
select throws_ok(
  $$select public.relink_loan_installment_payment('00000000-0000-0000-0000-0000001410d8',
      '00000000-0000-0000-0000-0000001410e2')$$,
  '23514', 'Solo se vincula el pago de un préstamo interno: en uno fiscal duplicaría el asiento',
  'relink refuses a fiscal loan');
update public.loans set channel_id = 'jouve_internal' where id = '00000000-0000-0000-0000-0000001410b5';

select lives_ok(
  $$select public.convert_loan_to_open_ended('00000000-0000-0000-0000-0000001410b5', 1)$$,
  'the service role converts the loan');
select is((select count(*) from public.loan_installments i
            where i.loan_id = '00000000-0000-0000-0000-0000001410b5'
              and i.status = 'pendiente' and i.due_date >= current_date),
  3::bigint, 'the converted loan keeps 3 upcoming cuotas');
select lives_ok(
  $$select public.relink_loan_installment_payment('00000000-0000-0000-0000-0000001410d8',
      '00000000-0000-0000-0000-0000001410e2')$$,
  'the service role links the cuota to its real movement');
select is((select (i.transaction_id, i.paid_amount, i.paid_amount_ars, i.paid_rate, i.capital_amount, i.paid_outside)::text
             from public.loan_installments i where i.id = '00000000-0000-0000-0000-0000001410d8'),
  '(00000000-0000-0000-0000-0000001410e2,400.00,622000.00,1555.000000,0.00,f)',
  'the cuota points to the movement with 400 / 622.000 / 1555, interest only');

select * from finish();
rollback;
