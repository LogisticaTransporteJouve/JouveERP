-- Plan de ahorro imputado a un empleado (20261113100000): a paid cuota still
-- posts like any plan cuota (the plan asset, never sueldos) and shows on the
-- employee's planilla of its due month as a line already paid (Total and
-- Pagado grow, Saldo does not), with no journal entry, payroll payment or
-- movement of its own. A closed planilla refuses the payment; the line is
-- removed when the cuota stops being paid and cannot be touched from the
-- planilla. One transaction, rolled back.

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000001511f1', 'finance@plan-sueldo.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000001511f1', 'finance');

insert into public.employees (id, legal_name, pay_frequency, hire_date, viatico_monthly) values
  ('00000000-0000-0000-0000-0000001511e1', 'Empleado Plan', 'mensual', '2020-01-01', 0),
  ('00000000-0000-0000-0000-0000001511e2', 'Empleado Otro', 'mensual', '2020-01-01', 0);

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000001511a1', 'Banco plan imputado', 'bank', 'ARS');

create function pg_temp.side(p_tx uuid, p_role text) returns numeric
language sql as $$
  select coalesce(sum(l.debit), 0)
    from public.journal_entries je
    join public.journal_entry_lines l on l.journal_entry_id = je.id
    join public.chart_of_accounts c on c.id = l.chart_of_accounts_id
   where je.source_table = 'transactions' and je.source_id = p_tx and not je.is_reversal
     and c.system_role::text = p_role
$$;

create function pg_temp.entry(p_year int, p_month int, p_employee uuid) returns uuid
language sql as $$
  select e.id from public.payroll_entries e
    join public.payroll_periods p on p.id = e.period_id
   where p.year = p_year and p.month = p_month and p.kind = 'monthly' and e.employee_id = p_employee
$$;

-- Only a plan is imputed to an employee.
select throws_ok(
  $$insert into public.loans (channel_id, currency, description, first_due_date, installments_count, kind, principal, salary_employee_id)
    values ('jouve_fiscal', 'ARS', 'Préstamo', '2094-03-13', 1, 'prestamo', 100, '00000000-0000-0000-0000-0000001511e1')$$,
  '23514', null, 'only a plan_ahorro takes an employee');

insert into public.loans (id, channel_id, currency, description, first_due_date, installments_count, kind, principal, salary_employee_id)
values ('00000000-0000-0000-0000-0000001511b1', 'jouve_fiscal', 'ARS', 'Plan Hilux', '2094-03-13', 3, 'plan_ahorro', 3000,
        '00000000-0000-0000-0000-0000001511e1');
insert into public.loan_installments (id, loan_id, number, due_date, amount,
  capital_amount, interest_amount, iva_amount, perception_amount, other_charges_amount)
values
  ('00000000-0000-0000-0000-0000001511d1', '00000000-0000-0000-0000-0000001511b1', 1, '2094-03-13', 1210, 1000, 100, 21, 0, 89),
  ('00000000-0000-0000-0000-0000001511d3', '00000000-0000-0000-0000-0000001511b1', 3, '2094-03-20', 1000, null, null, null, null, null);
insert into public.loan_installments (id, loan_id, number, due_date, amount)
values ('00000000-0000-0000-0000-0000001511d2', '00000000-0000-0000-0000-0000001511b1', 2, '2094-04-12', 1300);

-- April's planilla exists without the employee.
insert into public.payroll_periods (id, year, month, kind) values
  ('00000000-0000-0000-0000-0000001511c4', 2094, 4, 'monthly');
insert into public.payroll_entries (period_id, employee_id, sueldo_neto) values
  ('00000000-0000-0000-0000-0000001511c4', '00000000-0000-0000-0000-0000001511e2', 500);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001511f1","role":"authenticated"}', true);

create temp table t_pay1 on commit drop as
  select public.pay_loan_installment('00000000-0000-0000-0000-0000001511d1', '2094-03-13',
    '00000000-0000-0000-0000-0000001511a1', 1210) as tx_id;

-- (a) The journal: a split plan cuota, the capital to the plan, nothing to sueldos.
select is(pg_temp.side((select tx_id from t_pay1), 'planes_ahorro'), 1000::numeric,
  'split cuota: the capital still goes to the plan asset');
select is(pg_temp.side((select tx_id from t_pay1), 'sueldos'), 0::numeric,
  'split cuota: nothing goes to sueldos');

-- (b) March's planilla did not exist: created, with the line already paid.
select isnt(pg_temp.entry(2094, 3, '00000000-0000-0000-0000-0000001511e1'), null,
  'the missing planilla is created with the employee');
select is(
  (select amount from public.payroll_entry_extras where loan_installment_id = '00000000-0000-0000-0000-0000001511d1'),
  1210::numeric, 'the line carries the cuota amount');
select is(
  (select description from public.payroll_entry_extras where loan_installment_id = '00000000-0000-0000-0000-0000001511d1'),
  'Plan de ahorro: Plan Hilux · cuota 1', 'the line says which plan and cuota');
select results_eq(
  $$select total_a_pagar, paid_total, saldo, paid_in_kind, paid_fiscal + paid_internal
      from public.v_payroll_entries_with_payments
     where id = pg_temp.entry(2094, 3, '00000000-0000-0000-0000-0000001511e1')$$,
  $$values (1210::numeric, 1210::numeric, 0::numeric, 1210::numeric, 0::numeric)$$,
  'Total and Pagado include the line, Saldo does not change, no cash payment');
select is(
  (select count(*) from public.payroll_payments
    where entry_id = pg_temp.entry(2094, 3, '00000000-0000-0000-0000-0000001511e1')),
  0::bigint, 'no payroll payment (no movement) is created');
select is(
  (select count(*) from public.journal_entries je
    where je.source_table in ('payroll_entries', 'payroll_payments', 'payroll_entry_extras')
      and je.source_id in (select id from public.payroll_entries
                            where employee_id = '00000000-0000-0000-0000-0000001511e1')),
  0::bigint, 'the line posts no journal entry');
select is(
  (select count(*) from public.journal_entries je
    where je.source_table = 'transactions' and je.source_id = (select tx_id from t_pay1)),
  1::bigint, 'the cuota keeps a single entry');

-- (c) April's planilla exists without the employee: only their row is added.
create temp table t_pay2 on commit drop as
  select public.pay_loan_installment('00000000-0000-0000-0000-0000001511d2', '2094-04-12',
    '00000000-0000-0000-0000-0000001511a1', 1300) as tx_id;

select is(pg_temp.side((select tx_id from t_pay2), 'planes_ahorro'), 1300::numeric,
  'unsplit cuota: whole to the plan asset');
select is(pg_temp.side((select tx_id from t_pay2), 'sueldos'), 0::numeric,
  'unsplit cuota: nothing goes to sueldos');
select is(
  (select paid_total from public.v_payroll_entries_with_payments
    where id = pg_temp.entry(2094, 4, '00000000-0000-0000-0000-0000001511e1')),
  1300::numeric, 'the employee row is added to the existing planilla, paid');
select is(
  (select count(*) from public.payroll_entries where period_id = '00000000-0000-0000-0000-0000001511c4'),
  2::bigint, 'only that employee is added');

-- (d) The line belongs to the cuota.
select throws_ok(
  $$delete from public.payroll_entry_extras where loan_installment_id = '00000000-0000-0000-0000-0000001511d2'$$,
  '55006', null, 'the line is not removed from the planilla');
select throws_ok(
  $$update public.payroll_entry_extras set amount = 1 where loan_installment_id = '00000000-0000-0000-0000-0000001511d2'$$,
  '55006', null, 'nor edited');
select throws_ok(
  $$insert into public.payroll_entry_extras (entry_id, amount, description, loan_installment_id)
    values (pg_temp.entry(2094, 4, '00000000-0000-0000-0000-0000001511e2'), 1, 'x', '00000000-0000-0000-0000-0000001511d3')$$,
  '55006', null, 'nor loaded by hand');
select throws_ok(
  $$delete from public.payroll_entries where id = pg_temp.entry(2094, 4, '00000000-0000-0000-0000-0000001511e1')$$,
  '55006', null, 'the row holding it is not removed');
select throws_ok(
  $$update public.loans set salary_employee_id = '00000000-0000-0000-0000-0000001511e2'
     where id = '00000000-0000-0000-0000-0000001511b1'$$,
  '55006', null, 'the employee does not change once a cuota is on a planilla');

-- (e) Closing March posts nothing for the line; a cuota due in a closed month is refused.
update public.payroll_periods set status = 'closed'
 where year = 2094 and month = 3 and kind = 'monthly';
select is(
  (select count(*) from public.journal_entries je
    where je.source_table = 'payroll_entries'
      and je.source_id = pg_temp.entry(2094, 3, '00000000-0000-0000-0000-0000001511e1')),
  0::bigint, 'closing the planilla posts nothing for the line');
select throws_like(
  $$select public.pay_loan_installment('00000000-0000-0000-0000-0000001511d3', '2094-03-20',
      '00000000-0000-0000-0000-0000001511a1', 1000)$$,
  'La planilla de 03/2094 está cerrada%', 'a cuota due in a closed planilla is refused');
select is(
  (select status::text from public.loan_installments where id = '00000000-0000-0000-0000-0000001511d3'),
  'pendiente', 'and stays pending');

-- (f) A cuota that stops being paid takes its line away (no RPC unpays a
-- cuota today; the payment guard is lifted to reach the case).
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
alter table public.loan_installments disable trigger loan_installments_guard_payment;
update public.loan_installments set status = 'pendiente'
 where id = '00000000-0000-0000-0000-0000001511d2';
alter table public.loan_installments enable trigger loan_installments_guard_payment;

select is(
  (select count(*) from public.payroll_entry_extras where loan_installment_id = '00000000-0000-0000-0000-0000001511d2'),
  0::bigint, 'unpaid: the line is removed');
select is(
  (select paid_total from public.v_payroll_entries_with_payments
    where id = pg_temp.entry(2094, 4, '00000000-0000-0000-0000-0000001511e1')),
  0::numeric, 'and Pagado drops with it');

select * from finish();
rollback;
