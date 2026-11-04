-- Auditoría W11 · S4 F1 (20261104190100): only owner/admin reopen a closed
-- liquidación, and its entries and extras never leave it. Asserted as the
-- table owner with the user's claims (as `authenticated`, RLS would let the
-- PATCH through to the same trigger). One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000001190a1', 'finance@payroll-reopen-w11.test'),
  ('00000000-0000-0000-0000-0000001190a2', 'admin@payroll-reopen-w11.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000001190a1', 'finance'),
  ('00000000-0000-0000-0000-0000001190a2', 'admin');

insert into public.employees (id, legal_name, pay_frequency, base_salary, hire_date) values
  ('00000000-0000-0000-0000-0000001190b1', 'Reabrir Uno', 'mensual', 1000, '2080-01-01'),
  ('00000000-0000-0000-0000-0000001190b2', 'Reabrir Dos', 'mensual', 1000, '2080-01-01');
insert into public.payroll_periods (id, year, month) values
  ('00000000-0000-0000-0000-0000001190c1', 2088, 1),
  ('00000000-0000-0000-0000-0000001190c2', 2088, 2);
insert into public.payroll_entries (id, period_id, employee_id, sueldo_neto) values
  ('00000000-0000-0000-0000-0000001190d1', '00000000-0000-0000-0000-0000001190c1',
   '00000000-0000-0000-0000-0000001190b1', 1000),
  ('00000000-0000-0000-0000-0000001190d2', '00000000-0000-0000-0000-0000001190c2',
   '00000000-0000-0000-0000-0000001190b2', 1000);
insert into public.payroll_entry_extras (id, entry_id, amount, description) values
  ('00000000-0000-0000-0000-0000001190e1', '00000000-0000-0000-0000-0000001190d1',
   100, 'Horas extra');

-- 1. Finance closes ------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001190a1","role":"authenticated"}', true);

select lives_ok(
  $$update public.payroll_periods set status = 'closed'
     where id = '00000000-0000-0000-0000-0000001190c1'$$,
  'finance (hr:write) closes a draft period'
);

-- 2. Entries and extras stay in their closed period -----------------------------------

select throws_ok(
  $$update public.payroll_entries
       set period_id = '00000000-0000-0000-0000-0000001190c2'
     where id = '00000000-0000-0000-0000-0000001190d1'$$,
  '23514', null,
  'an entry of a closed period cannot be moved to a draft one'
);
select throws_ok(
  $$update public.payroll_entry_extras
       set entry_id = '00000000-0000-0000-0000-0000001190d2'
     where id = '00000000-0000-0000-0000-0000001190e1'$$,
  '23514', null,
  'an extra of a closed period cannot be moved to a draft entry'
);
select is(
  (select period_id from public.payroll_entries
    where id = '00000000-0000-0000-0000-0000001190d1'),
  '00000000-0000-0000-0000-0000001190c1'::uuid,
  'the entry is still in its closed period'
);

-- 3. Only owner/admin reopen -----------------------------------------------------------

select throws_ok(
  $$update public.payroll_periods set status = 'draft', closed_at = null, closed_by = null
     where id = '00000000-0000-0000-0000-0000001190c1'$$,
  '42501', null,
  'finance (no hr:admin) cannot reopen a closed period'
);
select is(
  (select status from public.payroll_periods
    where id = '00000000-0000-0000-0000-0000001190c1'),
  'closed',
  'the period stays closed'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001190a2","role":"authenticated"}', true);

select lives_ok(
  $$update public.payroll_periods set status = 'draft', closed_at = null, closed_by = null
     where id = '00000000-0000-0000-0000-0000001190c1'$$,
  'an admin reopens it'
);

-- 4. A draft entry still moves (nothing closed on either side) -------------------------

select lives_ok(
  $$update public.payroll_entry_extras
       set entry_id = '00000000-0000-0000-0000-0000001190d2'
     where id = '00000000-0000-0000-0000-0000001190e1'$$,
  'between draft periods the lock does not apply'
);

select * from finish();
rollback;
