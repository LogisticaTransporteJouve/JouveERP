-- An adelanto on the planilla (20261113150000): it is counted as paid, not in
-- Deudas, so the saldo is the same; a préstamo's cuota stays in Deudas; a
-- hand-typed Deudas leaves the adelanto apart; closing the planilla still
-- writes the adelanto to the employee's account and settles its plan. One
-- transaction, rolled back.

begin;

select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000005b7001', 'finance@advance-paid.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000005b7001', 'finance');

insert into public.employees (id, legal_name, pay_frequency, base_salary, hire_date) values
  ('00000000-0000-0000-0000-0000005b7e01', 'Adelanto Pagado', 'mensual', 1000, '2090-01-01');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000005b7c01', 'Caja adelanto pagado', 'cash', 'ARS');
insert into public.payroll_periods (id, year, month) values
  ('00000000-0000-0000-0000-0000005b7d05', 2098, 5);
insert into public.payroll_entries (id, period_id, employee_id, sueldo_neto, viaticos) values
  ('00000000-0000-0000-0000-0000005b7f05', '00000000-0000-0000-0000-0000005b7d05',
   '00000000-0000-0000-0000-0000005b7e01', 1000, 0);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000005b7001","role":"authenticated"}', true);

select public.record_employee_account_cash(
  '00000000-0000-0000-0000-0000005b7e01', 'advance', '00000000-0000-0000-0000-0000005b7c01',
  'jouve_internal', '2098-05-10', 150, 'Adelanto mayo', null, 150, '2098-05-01');

select results_eq(
  $$select deudas, paid_advance, paid_total, total_a_pagar, saldo
      from public.v_payroll_entries_with_payments
     where id = '00000000-0000-0000-0000-0000005b7f05'$$,
  $$values (0.00::numeric, 150.00::numeric, 150.00::numeric, 1000.00::numeric, 850.00::numeric)$$,
  'an adelanto is paid, not a debt: the saldo is what it was'
);

select public.record_employee_account_cash(
  '00000000-0000-0000-0000-0000005b7e01', 'advance', '00000000-0000-0000-0000-0000005b7c01',
  'jouve_internal', '2098-05-11', 300, 'Préstamo mayo', null, 100, '2098-05-01');

select results_eq(
  $$select deudas, adelantos from public.payroll_entries
     where id = '00000000-0000-0000-0000-0000005b7f05'$$,
  $$values (100.00::numeric, 150.00::numeric)$$,
  'a préstamo''s cuota stays in Deudas'
);

update public.payroll_entries set deudas = 40
 where id = '00000000-0000-0000-0000-0000005b7f05';

select results_eq(
  $$select deudas, deudas_override, adelantos from public.payroll_entries
     where id = '00000000-0000-0000-0000-0000005b7f05'$$,
  $$values (40.00::numeric, true, 150.00::numeric)$$,
  'a hand-typed Deudas leaves the adelanto apart'
);

update public.payroll_entries set deudas_override = false
 where id = '00000000-0000-0000-0000-0000005b7f05';

update public.payroll_entries set adelantos = 999
 where id = '00000000-0000-0000-0000-0000005b7f05';

select is(
  (select adelantos from public.payroll_entries
    where id = '00000000-0000-0000-0000-0000005b7f05'),
  150.00::numeric,
  'adelantos typed by hand is recomputed'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

update public.payroll_periods set status = 'closed'
 where id = '00000000-0000-0000-0000-0000005b7d05';

select results_eq(
  $$select amount from public.employee_account_movements
     where payroll_entry_id = '00000000-0000-0000-0000-0000005b7f05'
       and kind = 'payroll_discount'
     order by amount$$,
  $$values (100.00::numeric), (150.00::numeric)$$,
  'closing writes the préstamo cuota and the adelanto to the account'
);

select results_eq(
  $$select description, remaining from public.v_employee_debt_plans
     where employee_id = '00000000-0000-0000-0000-0000005b7e01'
     order by description$$,
  $$values ('Adelanto mayo'::text, 0.00::numeric), ('Préstamo mayo'::text, 200.00::numeric)$$,
  'the adelanto is settled and the préstamo keeps its rest'
);

select is(
  public.debt_plan_is_advance(150, 150),
  true,
  'a cuota that covers the total is an adelanto'
);

select is(
  public.debt_plan_is_advance(100, 300),
  false,
  'a smaller cuota is a préstamo'
);

select * from finish();

rollback;
