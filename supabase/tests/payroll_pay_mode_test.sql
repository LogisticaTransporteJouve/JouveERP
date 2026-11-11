-- Employee pay mode (20261111185000): 'recibo' employees take their salary
-- (and SAC) from the payslip and carry no separate vacaciones; raises skip
-- them; 'acordado' employees behave as before. One transaction, rolled back.

begin;

select plan(16);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000c201', 'finance@pay-mode.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-00000000c201', 'finance');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000c2a1', 'Banco Modalidad', 'bank', 'ARS');
insert into public.employees (id, legal_name, pay_frequency, hire_date, base_salary, pay_mode) values
  ('00000000-0000-0000-0000-00000000c2e1', 'Empleado Recibo', 'mensual', '2015-03-01', 700000, 'recibo'),
  ('00000000-0000-0000-0000-00000000c2e2', 'Empleado Acordado', 'mensual', '2015-03-01', 900000, 'acordado'),
  ('00000000-0000-0000-0000-00000000c2e3', 'Empleado Cambia', 'mensual', '2015-03-01', 600000, 'acordado');
insert into public.payroll_periods (id, year, month, kind) values
  ('00000000-0000-0000-0000-00000000c2d1', 2096, 3, 'monthly'),
  ('00000000-0000-0000-0000-00000000c2d2', 2096, 12, 'sac'),
  ('00000000-0000-0000-0000-00000000c2d3', 2096, 2, 'monthly');
insert into public.payroll_entries (id, period_id, employee_id, sueldo_neto, vacaciones_monto) values
  ('00000000-0000-0000-0000-00000000c2c3', '00000000-0000-0000-0000-00000000c2d3',
   '00000000-0000-0000-0000-00000000c2e3', 600000, 40000);
update public.payroll_periods set status = 'closed' where id = '00000000-0000-0000-0000-00000000c2d3';
insert into public.payroll_entries (id, period_id, employee_id, sueldo_neto, vacaciones_monto) values
  ('00000000-0000-0000-0000-00000000c2c4', '00000000-0000-0000-0000-00000000c2d1',
   '00000000-0000-0000-0000-00000000c2e3', 600000, 50000);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000c201","role":"authenticated"}', true);
set local role authenticated;

-- 1. create_employee / update_employee -------------------------------------------------

create temporary table t_new as
  select public.create_employee(
    '{"legal_name":"Empleado Nuevo Recibo","pay_frequency":"mensual","hire_date":"2026-01-01","pay_mode":"recibo"}'::jsonb,
    'Chofer / Acompañante', null, '2026-11-02') as id;

select is(
  (select e.pay_mode from public.employees e join t_new on t_new.id = e.id),
  'recibo',
  '1. create_employee takes pay_mode'
);

select lives_ok(
  format($$select public.update_employee(%L, '{"pay_mode":"acordado"}'::jsonb, 'Chofer / Acompañante', null)$$,
    (select id from t_new)),
  '1. update_employee takes pay_mode'
);

select throws_ok(
  $$select public.create_employee('{"legal_name":"X","pay_mode_x":"recibo"}'::jsonb, 'Chofer / Acompañante', null, '2026-11-02')$$,
  'P0001',
  'p_employee has a field that is not editable',
  '1. an unknown key is still refused'
);

select throws_ok(
  format($$select public.update_employee(%L, '{"pay_mode":"otro"}'::jsonb, 'Chofer / Acompañante', null)$$,
    (select id from t_new)),
  '23514',
  null,
  '1. an unknown pay mode is refused'
);

-- 2. Raises ----------------------------------------------------------------------------

select is(
  public.apply_salary_raise(
    array['00000000-0000-0000-0000-00000000c2e1', '00000000-0000-0000-0000-00000000c2e2']::uuid[],
    10, '2096-01-01', 'Paritaria'),
  1,
  '2. a raise skips the recibo employee'
);

reset role;
select results_eq(
  $$select base_salary from public.employees
     where id in ('00000000-0000-0000-0000-00000000c2e1', '00000000-0000-0000-0000-00000000c2e2')
     order by legal_name$$,
  $$values (990000.00::numeric), (700000.00::numeric)$$,
  '2. the acordado employee is raised, the recibo one is not'
);
set local role authenticated;

-- 3. Monthly recibo → sueldo and base salary -------------------------------------------

insert into public.payroll_entries (id, period_id, employee_id, sueldo_neto, vacaciones_monto, recibo_neto) values
  ('00000000-0000-0000-0000-00000000c2c1', '00000000-0000-0000-0000-00000000c2d1',
   '00000000-0000-0000-0000-00000000c2e1', 700000, 30000, 750000);

reset role;
select results_eq(
  $$select sueldo_neto, vacaciones_monto from public.payroll_entries
     where id = '00000000-0000-0000-0000-00000000c2c1'$$,
  $$values (750000.00::numeric, 0::numeric)$$,
  '3/6. the recibo is the sueldo; vacaciones stay 0'
);

select results_eq(
  $$select e.base_salary, c.effective_month, c.reason
      from public.employees e
      join public.employee_salary_changes c on c.employee_id = e.id
     where e.id = '00000000-0000-0000-0000-00000000c2e1'$$,
  $$values (750000.00::numeric, '2096-03-01'::date, 'Recibo 03/2096'::text)$$,
  '3. the recibo sets the base salary from its month'
);
set local role authenticated;

update public.payroll_entries set sueldo_neto = 100000, vacaciones_monto = 20000
 where id = '00000000-0000-0000-0000-00000000c2c1';

select results_eq(
  $$select sueldo_neto, vacaciones_monto from public.payroll_entries
     where id = '00000000-0000-0000-0000-00000000c2c1'$$,
  $$values (750000.00::numeric, 0::numeric)$$,
  '6. a later write of sueldo or vacaciones does not override a loaded recibo'
);

-- 6. Final settlement: vacaciones 0, the loaded recibo stays the sueldo.
select lives_ok(
  $$select public.apply_final_settlement('00000000-0000-0000-0000-00000000c2e1', 2096, 3, 400000, 80000,
      'Liquidación final:', 0, 'Liquidación final: SAC proporcional')$$,
  '6. a final settlement on a recibo employee'
);

select results_eq(
  $$select sueldo_neto, vacaciones_monto from public.payroll_entries
     where id = '00000000-0000-0000-0000-00000000c2c1'$$,
  $$values (750000.00::numeric, 0::numeric)$$,
  '6. the final settlement keeps the recibo and no vacaciones'
);

-- 4. SAC recibo: the entry's sueldo, not the base salary; fully fiscal.
insert into public.payroll_entries (id, period_id, employee_id, sueldo_neto, recibo_neto) values
  ('00000000-0000-0000-0000-00000000c2c2', '00000000-0000-0000-0000-00000000c2d2',
   '00000000-0000-0000-0000-00000000c2e1', 0, 380000);
insert into public.payroll_payments (id, entry_id, account_id, amount, method, paid_at) values
  ('00000000-0000-0000-0000-00000000c2b1', '00000000-0000-0000-0000-00000000c2c2',
   '00000000-0000-0000-0000-00000000c2a1', 380000, 'transferencia', '2096-12-18');

reset role;
select results_eq(
  $$select pe.sueldo_neto, e.base_salary, p.channel_id
      from public.payroll_entries pe
      join public.employees e on e.id = pe.employee_id
      join public.payroll_payments p on p.entry_id = pe.id
     where pe.id = '00000000-0000-0000-0000-00000000c2c2'$$,
  $$values (380000.00::numeric, 750000.00::numeric, 'jouve_fiscal'::text)$$,
  '4. a SAC recibo is the SAC amount, leaves the base salary and goes wholly to the books'
);
set local role authenticated;

-- 5. Acordado SAC: beyond recibo − embargo goes internal.
insert into public.payroll_entries (id, period_id, employee_id, sueldo_neto, recibo_neto) values
  ('00000000-0000-0000-0000-00000000c2c5', '00000000-0000-0000-0000-00000000c2d2',
   '00000000-0000-0000-0000-00000000c2e2', 495000, 300000);
insert into public.payroll_payments (id, entry_id, account_id, amount, method, paid_at) values
  ('00000000-0000-0000-0000-00000000c2b2', '00000000-0000-0000-0000-00000000c2c5',
   '00000000-0000-0000-0000-00000000c2a1', 495000, 'transferencia', '2096-12-18');

reset role;
select results_eq(
  $$select paid_fiscal, paid_internal, sueldo_neto from public.v_payroll_entries_with_payments
     where id = '00000000-0000-0000-0000-00000000c2c5'$$,
  $$values (300000.00::numeric, 195000.00::numeric, 495000.00::numeric)$$,
  '5. an acordado SAC keeps its amount; the recibo part goes to the books, the rest to management'
);
set local role authenticated;

-- 7. Switching to recibo zeroes draft vacaciones only.
update public.employees set pay_mode = 'recibo' where id = '00000000-0000-0000-0000-00000000c2e3';

reset role;
select results_eq(
  $$select pp.status, pe.vacaciones_monto from public.payroll_entries pe
      join public.payroll_periods pp on pp.id = pe.period_id
     where pe.employee_id = '00000000-0000-0000-0000-00000000c2e3'
     order by pp.status$$,
  $$values ('closed'::text, 40000.00::numeric), ('draft'::text, 0::numeric)$$,
  '7. switching to recibo zeroes the draft vacaciones and leaves the closed ones'
);

-- 8. What Gestión and the assistant read.
select is(
  (select amount from public.ai_payroll_concepts('2096-03', '2096-03')
    where concept = 'vacaciones'),
  null,
  '8. the assistant sees no vacaciones for recibo employees'
);

select is(
  (select sum(total_a_pagar) from public.v_payroll_entries_resolved
    where id in ('00000000-0000-0000-0000-00000000c2c1', '00000000-0000-0000-0000-00000000c2c4')),
  1350000.00,
  '8. total_a_pagar carries no vacaciones for them'
);

select * from finish();

rollback;
