-- Sueldos reales (roadmap 3.1 + 3.2): garnishments set the entry's embargo
-- (on insert, on a salary or receipt change, and when the garnishment
-- changes, only in draft periods), the views net it and split what was paid
-- by method, the SAC period seeds its suggestion, and the grants. One
-- transaction, rolled back.

begin;

select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000009a1', 'finance@payroll-real.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000009a1', 'finance');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);

-- 1. Garnishments --------------------------------------------------------------

insert into public.employees (id, legal_name, pay_frequency, base_salary, hire_date) values
  ('00000000-0000-0000-0000-0000000009b1', 'Embargado Uno', 'mensual', 1000, '2090-01-01');

insert into public.employee_garnishments (id, employee_id, mode, percentage, active_from, beneficiary) values
  ('00000000-0000-0000-0000-0000000009e1', '00000000-0000-0000-0000-0000000009b1', 'percentage', 10,
   '2098-01-01', 'Cuota alimentaria');

insert into public.payroll_periods (id, year, month) values
  ('00000000-0000-0000-0000-0000000009c1', 2098, 3),
  ('00000000-0000-0000-0000-0000000009c2', 2097, 12);
insert into public.payroll_entries (id, period_id, employee_id, sueldo_neto) values
  ('00000000-0000-0000-0000-0000000009d1', '00000000-0000-0000-0000-0000000009c1',
   '00000000-0000-0000-0000-0000000009b1', 1000),
  ('00000000-0000-0000-0000-0000000009d2', '00000000-0000-0000-0000-0000000009c2',
   '00000000-0000-0000-0000-0000000009b1', 1000);

select is(
  (select embargo from public.payroll_entries where id = '00000000-0000-0000-0000-0000000009d1'),
  100.00::numeric,
  'a new entry takes the active garnishment over the agreed salary'
);

select is(
  (select embargo from public.payroll_entries where id = '00000000-0000-0000-0000-0000000009d2'),
  0.00::numeric,
  'a month before the garnishment starts gets none'
);

update public.payroll_entries set recibo_neto = 800
 where id = '00000000-0000-0000-0000-0000000009d1';

select is(
  (select embargo from public.payroll_entries where id = '00000000-0000-0000-0000-0000000009d1'),
  80.00::numeric,
  'loading the receipt net recomputes it over the receipt'
);

select is(
  (select total_a_pagar from public.v_payroll_entries_resolved
    where id = '00000000-0000-0000-0000-0000000009d1'),
  920.00::numeric,
  'the total to pay subtracts the garnishment'
);

update public.payroll_entries set embargo = 50
 where id = '00000000-0000-0000-0000-0000000009d1';
update public.payroll_entries set notes = 'otra cosa'
 where id = '00000000-0000-0000-0000-0000000009d1';

select is(
  (select embargo from public.payroll_entries where id = '00000000-0000-0000-0000-0000000009d1'),
  50.00::numeric,
  'a hand-edited garnishment survives edits of other fields'
);

-- Back to the computed figure (20261104095100: a hand edit is an override).
update public.payroll_entries set embargo_override = false
 where id = '00000000-0000-0000-0000-0000000009d1';
update public.employee_garnishments set percentage = 20
 where id = '00000000-0000-0000-0000-0000000009e1';

select is(
  (select embargo from public.payroll_entries where id = '00000000-0000-0000-0000-0000000009d1'),
  160.00::numeric,
  'changing the garnishment refreshes the draft entries'
);

update public.payroll_periods set status = 'closed'
 where id = '00000000-0000-0000-0000-0000000009c1';
update public.employee_garnishments set percentage = 30
 where id = '00000000-0000-0000-0000-0000000009e1';

select is(
  (select embargo from public.payroll_entries where id = '00000000-0000-0000-0000-0000000009d1'),
  160.00::numeric,
  'a closed period keeps its garnishment'
);

select throws_ok(
  $$insert into public.employee_garnishments (employee_id, mode, percentage, amount, active_from)
    values ('00000000-0000-0000-0000-0000000009b1', 'percentage', 10, 5, '2098-01-01')$$,
  '23514',
  null,
  'a garnishment is a percentage or an amount, not both'
);

-- 2. Paid per method -----------------------------------------------------------

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000000009f1', 'Caja sueldos reales', 'cash', 'ARS');
insert into public.payroll_payments (entry_id, account_id, channel_id, amount, method, paid_at) values
  ('00000000-0000-0000-0000-0000000009d2', '00000000-0000-0000-0000-0000000009f1', 'jouve_fiscal', 600, 'transferencia', current_date),
  ('00000000-0000-0000-0000-0000000009d2', '00000000-0000-0000-0000-0000000009f1', 'jouve_internal', 150, 'efectivo', current_date);

select results_eq(
  $$select paid_transferencia, paid_efectivo, paid_total
      from public.v_payroll_entries_with_payments
     where id = '00000000-0000-0000-0000-0000000009d2'$$,
  $$values (600.00::numeric, 150.00::numeric, 750.00::numeric)$$,
  'the payments view splits what was paid by method'
);

-- 3. SAC -----------------------------------------------------------------------

insert into public.employees (id, legal_name, pay_frequency, base_salary, hire_date) values
  ('00000000-0000-0000-0000-0000000009b2', 'Aguinaldo Pleno', 'mensual', 1000, '2090-01-01'),
  ('00000000-0000-0000-0000-0000000009b3', 'Aguinaldo Proporcional', 'mensual', 1000, '2096-04-01');

insert into public.payroll_periods (id, year, month) values
  ('00000000-0000-0000-0000-000000000ac1', 2096, 1),
  ('00000000-0000-0000-0000-000000000ac2', 2096, 5);
insert into public.payroll_entries (id, period_id, employee_id, sueldo_neto) values
  ('00000000-0000-0000-0000-000000000ad1', '00000000-0000-0000-0000-000000000ac1',
   '00000000-0000-0000-0000-0000000009b2', 1000),
  ('00000000-0000-0000-0000-000000000ad2', '00000000-0000-0000-0000-000000000ac2',
   '00000000-0000-0000-0000-0000000009b2', 1200),
  ('00000000-0000-0000-0000-000000000ad3', '00000000-0000-0000-0000-000000000ac2',
   '00000000-0000-0000-0000-0000000009b3', 1000);
insert into public.payroll_entry_extras (entry_id, amount, description) values
  ('00000000-0000-0000-0000-000000000ad2', 100, 'Horas extra');

select is(
  public.payroll_sac_suggestion('00000000-0000-0000-0000-0000000009b2', 2096, 1),
  650.00::numeric,
  'the SAC suggestion is half the best month (salary + extras)'
);

-- Hired April 1: 91 of the 182 days of the first half of 2096 (leap year).
select is(
  public.payroll_sac_suggestion('00000000-0000-0000-0000-0000000009b3', 2096, 1),
  250.00::numeric,
  'a hire inside the half prorates it by days'
);

create temporary table t_sac as
  select public.seed_sac_period(2096, 1) as id;

select results_eq(
  $$select pp.kind, pp.month, pe.sueldo_neto, pe.viaticos
      from public.payroll_periods pp
      join public.payroll_entries pe on pe.period_id = pp.id
     where pp.id = (select id from t_sac)
       and pe.employee_id = '00000000-0000-0000-0000-0000000009b2'$$,
  $$values ('sac'::text, 6, 650.00::numeric, 0.00::numeric)$$,
  'seed_sac_period creates the June SAC period with the suggestion and no viático'
);

select is(
  public.seed_sac_period(2096, 1),
  (select id from t_sac),
  'seed_sac_period is idempotent'
);

select isnt(
  public.seed_payroll_period(2096, 6),
  (select id from t_sac),
  'the June monthly planilla is its own period'
);

select throws_ok(
  $$select public.seed_sac_period(2096, 3)$$,
  '22023',
  'El semestre del SAC es 1 o 2.',
  'the SAC half is 1 or 2'
);

insert into public.payroll_payments (entry_id, account_id, channel_id, amount, method, paid_at)
select pe.id, '00000000-0000-0000-0000-0000000009f1', 'jouve_internal', 100, 'efectivo', current_date
  from public.payroll_entries pe
 where pe.period_id = (select id from t_sac)
   and pe.employee_id = '00000000-0000-0000-0000-0000000009b2';

select is(
  (select t.description from public.transactions t
     join public.payroll_payments pay on pay.transaction_id = t.id
     join public.payroll_entries pe on pe.id = pay.entry_id
    where pe.period_id = (select id from t_sac)),
  'SAC Aguinaldo Pleno (1.er semestre 2096)',
  'a SAC payment is described as such'
);

-- 4. Grants --------------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.seed_sac_period(integer, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.seed_sac_period(integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.payroll_sac_suggestion(uuid, integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.payroll_garnishment_amount(uuid, uuid, numeric)', 'execute'),
  'the new payroll functions reach authenticated, never anon'
);

select * from finish();
rollback;
