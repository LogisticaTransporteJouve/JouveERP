-- Auditoría W12 · S2 F3 (20261104194100): payroll_periods.posts_employee_accounts
-- is set only by the database. Asserted as the table owner with the user's
-- claims (as `authenticated`, RLS would let the write through to the same
-- trigger). One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000001294a1', 'finance@payroll-posts-w12.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000001294a1', 'finance');

insert into public.payroll_periods (id, year, month) values
  ('00000000-0000-0000-0000-0000001294c1', 2089, 1);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001294a1","role":"authenticated"}', true);

-- 1. Finance cannot write the column -------------------------------------------------

select throws_ok(
  $$update public.payroll_periods set posts_employee_accounts = false
     where id = '00000000-0000-0000-0000-0000001294c1'$$,
  '42501', null,
  'finance cannot turn off the account posting of a draft period'
);
select throws_ok(
  $$insert into public.payroll_periods (year, month, posts_employee_accounts)
    values (2089, 2, false)$$,
  '42501', null,
  'finance cannot insert a period that skips the account posting'
);

-- 2. Every other write still passes ---------------------------------------------------

select lives_ok(
  $$insert into public.payroll_periods (id, year, month)
    values ('00000000-0000-0000-0000-0000001294c2', 2089, 3)$$,
  'finance inserts a period with the default'
);
select lives_ok(
  $$update public.payroll_periods set notes = 'ok', posts_employee_accounts = true
     where id = '00000000-0000-0000-0000-0000001294c1'$$,
  'an update that keeps the value passes'
);
select lives_ok(
  $$update public.payroll_periods set status = 'closed'
     where id = '00000000-0000-0000-0000-0000001294c1'$$,
  'finance closes the period'
);
select is(
  (select posts_employee_accounts from public.payroll_periods
    where id = '00000000-0000-0000-0000-0000001294c1'),
  true,
  'the period still posts to the employee accounts'
);

-- 3. service_role (a backfill) passes -------------------------------------------------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select lives_ok(
  $$update public.payroll_periods set posts_employee_accounts = false
     where id = '00000000-0000-0000-0000-0000001294c2'$$,
  'service_role may change it'
);

select * from finish();
rollback;
