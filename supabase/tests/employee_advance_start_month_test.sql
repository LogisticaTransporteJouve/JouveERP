-- «Adelanto a empleado» with the payroll month chosen (20261112160000): the
-- plan starts in the picked month, so its installment is the Deudas of that
-- planilla and not of the date's; the window is the month before through two
-- months after; the default stays the date's month. One transaction, rolled
-- back.

begin;

select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000005a7001', 'finance@advance-month.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000005a7001', 'finance');

insert into public.employees (id, legal_name, pay_frequency, base_salary, hire_date) values
  ('00000000-0000-0000-0000-0000005a7e01', 'Adelanto Mes Elegido', 'mensual', 1000, '2090-01-01');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000005a7c01', 'Caja adelantos', 'cash', 'ARS');
insert into public.payroll_periods (id, year, month) values
  ('00000000-0000-0000-0000-0000005a7d03', 2098, 3),
  ('00000000-0000-0000-0000-0000005a7d04', 2098, 4);
insert into public.payroll_entries (id, period_id, employee_id, sueldo_neto) values
  ('00000000-0000-0000-0000-0000005a7f03', '00000000-0000-0000-0000-0000005a7d03',
   '00000000-0000-0000-0000-0000005a7e01', 1000),
  ('00000000-0000-0000-0000-0000005a7f04', '00000000-0000-0000-0000-0000005a7d04',
   '00000000-0000-0000-0000-0000005a7e01', 1000);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000005a7001","role":"authenticated"}', true);

select lives_ok(
  $$select public.record_employee_account_cash(
      '00000000-0000-0000-0000-0000005a7e01', 'advance', '00000000-0000-0000-0000-0000005a7c01',
      'jouve_fiscal', '2098-03-20', 300, 'Adelanto para abril', null, 300, '2098-04-15')$$,
  'an advance dated in March discounted in April'
);

select is(
  (select start_month from public.employee_debt_plans
    where employee_id = '00000000-0000-0000-0000-0000005a7e01'),
  '2098-04-01'::date,
  'its plan starts in the picked month'
);

select results_eq(
  $$select p.month, e.deudas from public.payroll_entries e
      join public.payroll_periods p on p.id = e.period_id
     where e.employee_id = '00000000-0000-0000-0000-0000005a7e01'
     order by p.month$$,
  $$values (3, 0.00::numeric), (4, 300.00::numeric)$$,
  'the April planilla discounts it, the March one does not'
);

select throws_ok(
  $$select public.record_employee_account_cash(
      '00000000-0000-0000-0000-0000005a7e01', 'advance', '00000000-0000-0000-0000-0000005a7c01',
      'jouve_fiscal', '2098-03-20', 300, null, null, 300, '2098-06-01')$$,
  '23514', null,
  'a month beyond two after the date is refused'
);

select throws_ok(
  $$select public.record_employee_account_cash(
      '00000000-0000-0000-0000-0000005a7e01', 'payment', '00000000-0000-0000-0000-0000005a7c01',
      'jouve_fiscal', '2098-03-20', 300, null, null, null, '2098-04-01')$$,
  '23514', null,
  'a payment does not pick a payroll month'
);

create temp table adv2 as
select public.record_employee_account_cash(
  '00000000-0000-0000-0000-0000005a7e01', 'advance', '00000000-0000-0000-0000-0000005a7c01',
  'jouve_fiscal', '2098-03-21', 100, 'Adelanto sin mes', null, 100) as movement_id;

select is(
  (select p.start_month from public.employee_debt_plans p
     join public.employee_account_movements m on m.plan_id = p.id
     join adv2 on adv2.movement_id = m.id),
  '2098-03-01'::date,
  'without a month the plan starts in the date''s month'
);

select ok(
  has_function_privilege('authenticated', 'public.record_employee_account_cash(uuid, text, uuid, text, date, numeric, text, uuid, numeric, date)', 'execute')
  and not has_function_privilege('anon', 'public.record_employee_account_cash(uuid, text, uuid, text, date, numeric, text, uuid, numeric, date)', 'execute'),
  'authenticated runs it, anon does not'
);

select * from finish();

rollback;
