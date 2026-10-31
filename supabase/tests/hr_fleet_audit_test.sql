-- Audit 2026-10-31, Módulos S1/S7/S8 (20261031193030..193032): a payroll
-- payment debits 5.3.1 "Sueldos y jornales" (role sueldos), a loose expense
-- still debits gastos; grant_vacation_balances carries over only from an
-- extended or unexpired previous period, caps it at a third of its entitled
-- days, closes the source and honors hr_settings.vacation_carryover; fuel
-- loads and maintenance records link to a purchase invoice or a movement.
-- One transaction, rolled back.

begin;

select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000009f1', 'finance@hr-fleet.test'),
  ('00000000-0000-0000-0000-0000000009f2', 'admin@hr-fleet.test'),
  ('00000000-0000-0000-0000-0000000009f3', 'ops@hr-fleet.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000009f1', 'finance'),
  ('00000000-0000-0000-0000-0000000009f2', 'admin'),
  ('00000000-0000-0000-0000-0000000009f3', 'operations');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000a901', 'Banco Sueldos', 'bank', 'ARS');

-- S1 -------------------------------------------------------------------------

select is(
  (select code from public.chart_of_accounts where system_role = 'sueldos' and is_active),
  '5.3.1',
  '5.3.1 Sueldos y jornales holds the sueldos role'
);

insert into public.employees (id, legal_name, pay_frequency, hire_date) values
  ('00000000-0000-0000-0000-0000000009e1', 'Empleado Sueldo', 'mensual', '2015-03-01');
insert into public.payroll_periods (id, year, month) values
  ('00000000-0000-0000-0000-0000000009d1',
   extract(year from current_date)::int, extract(month from current_date)::int);
insert into public.payroll_entries (id, period_id, employee_id, sueldo_neto) values
  ('00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-0000000009d1',
   '00000000-0000-0000-0000-0000000009e1', 500000);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000009f1","role":"authenticated"}', true);

insert into public.payroll_payments (id, entry_id, account_id, channel_id, amount, method, paid_at) values
  ('00000000-0000-0000-0000-0000000009b1', '00000000-0000-0000-0000-0000000009c1',
   '00000000-0000-0000-0000-00000000a901', 'jouve_fiscal', 500000, 'transferencia', current_date);

insert into public.transactions
  (id, account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description)
values
  ('00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-00000000a901', 'jouve_fiscal',
   'expense', 100, 'ARS', current_date, date_trunc('month', current_date)::date, 'Gasto suelto');

set constraints all immediate;
reset role;

select ok(
  (select t.is_payroll from public.transactions t
     join public.payroll_payments pp on pp.transaction_id = t.id
    where pp.id = '00000000-0000-0000-0000-0000000009b1'),
  'the movement of a payroll payment is marked is_payroll'
);

select is(
  (select c.code from public.journal_entry_lines l
     join public.journal_entries e on e.id = l.journal_entry_id
     join public.chart_of_accounts c on c.id = l.chart_of_accounts_id
     join public.payroll_payments pp on pp.transaction_id = e.source_id
    where e.source_table = 'transactions' and pp.id = '00000000-0000-0000-0000-0000000009b1'
      and l.debit > 0 and not e.is_reversal),
  '5.3.1',
  'a payroll payment debits Sueldos y jornales'
);

select is(
  (select c.code from public.journal_entry_lines l
     join public.journal_entries e on e.id = l.journal_entry_id
     join public.chart_of_accounts c on c.id = l.chart_of_accounts_id
    where e.source_table = 'transactions' and e.source_id = '00000000-0000-0000-0000-0000000009a1'
      and l.debit > 0),
  '5.3.5',
  'a loose expense still debits Otros gastos'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000009f1","role":"authenticated"}', true);
set constraints all deferred;
update public.payroll_payments set amount = 450000 where id = '00000000-0000-0000-0000-0000000009b1';
set constraints all immediate;
reset role;

select is(
  (select c.code || ':' || l.debit::text from public.journal_entry_lines l
     join public.journal_entries e on e.id = l.journal_entry_id
     join public.chart_of_accounts c on c.id = l.chart_of_accounts_id
     join public.payroll_payments pp on pp.transaction_id = e.source_id
    where e.source_table = 'transactions' and pp.id = '00000000-0000-0000-0000-0000000009b1'
      and l.debit > 0 and not e.is_reversal
      and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = e.id)),
  '5.3.1:450000.00',
  'editing the payment re-posts to Sueldos y jornales'
);

-- S7 -------------------------------------------------------------------------
-- Target year 2030: the 2029 balances expire 2030-04-30, before the grant
-- date (2030-10-01), so only an extended one carries.

insert into public.employees (id, legal_name, pay_frequency, hire_date) values
  ('00000000-0000-0000-0000-0000000009e2', 'Vencido', 'mensual', '2010-01-01'),
  ('00000000-0000-0000-0000-0000000009e3', 'Extendido', 'mensual', '2010-01-01'),
  ('00000000-0000-0000-0000-0000000009e4', 'Extendido chico', 'mensual', '2010-01-01');
insert into public.employee_vacation_balances
  (id, employee_id, period_year, entitled_days, used_days, granted_at, expires_at, status)
values
  ('00000000-0000-0000-0000-000000000992', '00000000-0000-0000-0000-0000000009e2', 2029, 28, 0,
   '2029-10-01', '2030-04-30', 'active'),
  ('00000000-0000-0000-0000-000000000993', '00000000-0000-0000-0000-0000000009e3', 2029, 28, 2,
   '2029-10-01', '2030-04-30', 'extended'),
  ('00000000-0000-0000-0000-000000000994', '00000000-0000-0000-0000-0000000009e4', 2029, 28, 25,
   '2029-10-01', '2030-04-30', 'extended');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000009f2","role":"authenticated"}', true);

create temp table granted on commit drop as
  select * from public.grant_vacation_balances(2030, true);

reset role;

select is(
  (select carryover_days from public.employee_vacation_balances
    where employee_id = '00000000-0000-0000-0000-0000000009e2' and period_year = 2030),
  0,
  'an expired balance carries nothing'
);
select is(
  (select carryover_days from public.employee_vacation_balances
    where employee_id = '00000000-0000-0000-0000-0000000009e3' and period_year = 2030),
  9,
  'an extended balance carries at most a third of its entitled days (26 left, cap 9)'
);
select is(
  (select carryover_days from public.employee_vacation_balances
    where employee_id = '00000000-0000-0000-0000-0000000009e4' and period_year = 2030),
  3,
  'below the cap it carries what is left'
);
select is(
  (select status from public.employee_vacation_balances where id = '00000000-0000-0000-0000-000000000993'),
  'expired',
  'the carried source is closed, so its days are not counted twice'
);

update public.hr_settings set value = 'false'::jsonb where key = 'vacation_carryover';
update public.employee_vacation_balances
   set status = 'extended'
 where employee_id = '00000000-0000-0000-0000-0000000009e3' and period_year = 2030;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000009f2","role":"authenticated"}', true);
create temp table granted2 on commit drop as
  select * from public.grant_vacation_balances(2031, true);
reset role;

select is(
  (select carryover_days from public.employee_vacation_balances
    where employee_id = '00000000-0000-0000-0000-0000000009e3' and period_year = 2031),
  0,
  'with hr_settings.vacation_carryover off nothing carries, even when asked'
);

-- S8 -------------------------------------------------------------------------

insert into public.vehicles (id, patente, vehicle_type) values
  ('00000000-0000-0000-0000-000000000981', 'AA999ZZ', 'camion');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000009f3","role":"authenticated"}', true);

select lives_ok(
  $$insert into public.fuel_loads (vehicle_id, load_date, liters, amount, transaction_id)
    values ('00000000-0000-0000-0000-000000000981', current_date, 50, 100,
            '00000000-0000-0000-0000-0000000009a1')$$,
  'operations links a fuel load to a movement'
);
select lives_ok(
  $$insert into public.maintenance_records (vehicle_id, service_date, kind, description, cost, transaction_id)
    values ('00000000-0000-0000-0000-000000000981', current_date, 'service', 'Service', 100,
            '00000000-0000-0000-0000-0000000009a1')$$,
  'operations links a maintenance record to a movement'
);
select throws_ok(
  $$insert into public.fuel_loads (vehicle_id, load_date, liters, amount, purchase_invoice_id)
    values ('00000000-0000-0000-0000-000000000981', current_date, 50, 100,
            '00000000-0000-0000-0000-000000000000')$$,
  '23503',
  null,
  'a link to a missing purchase invoice is rejected'
);

reset role;
delete from public.transactions where id = '00000000-0000-0000-0000-0000000009a1';
select is(
  (select count(*)::int from public.fuel_loads
    where vehicle_id = '00000000-0000-0000-0000-000000000981' and transaction_id is null),
  1,
  'deleting the movement unlinks the fuel load, it does not delete it'
);

select * from finish();
rollback;
