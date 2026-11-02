-- Tareas (roadmap 1.4/1.5): the automatic tasks' sync (create once, close when
-- settled, reopen, a user's close and due date kept), the recurring
-- occurrences, the identity guard, the RPC grants and RLS by role and source.
-- One transaction, rolled back.

begin;

select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000007a1', 'ops@tasks.test'),
  ('00000000-0000-0000-0000-0000000007a2', 'finance@tasks.test'),
  ('00000000-0000-0000-0000-0000000007a3', 'warehouse@tasks.test'),
  ('00000000-0000-0000-0000-0000000007a4', 'driver@tasks.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000007a1', 'operations'),
  ('00000000-0000-0000-0000-0000000007a2', 'finance'),
  ('00000000-0000-0000-0000-0000000007a3', 'warehouse'),
  ('00000000-0000-0000-0000-0000000007a4', 'driver');

-- Documents post journals, which want a role.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temporary table t_day as
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date as today;

-- 1. Grants ------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.sync_automatic_tasks(date)', 'execute')
  and not has_function_privilege('anon', 'public.sync_automatic_tasks(date)', 'execute')
  and has_function_privilege('service_role', 'public.sync_automatic_tasks(date)', 'execute'),
  'only the service role runs sync_automatic_tasks'
);

select ok(
  not has_function_privilege('authenticated', 'public.materialize_recurring_tasks(date)', 'execute')
  and not has_function_privilege('anon', 'public.materialize_recurring_tasks(date)', 'execute')
  and has_function_privilege('service_role', 'public.materialize_recurring_tasks(date)', 'execute'),
  'only the service role runs materialize_recurring_tasks'
);

-- 2. Automatic tasks -----------------------------------------------------------------

insert into public.vehicles (id, patente, vehicle_type) values
  ('00000000-0000-0000-0000-0000000007b1', 'TK001AA', 'camion');

insert into public.fleet_documents (id, vehicle_id, kind, expires_at) values
  ('00000000-0000-0000-0000-0000000007c1', '00000000-0000-0000-0000-0000000007b1', 'vtv',
   (select today from t_day) + 10),
  ('00000000-0000-0000-0000-0000000007c2', '00000000-0000-0000-0000-0000000007b1', 'seguro',
   (select today from t_day) + 200);

-- Run the sync on its own first: joined to tasks in one query, the planner
-- may never execute it (tasks is empty), and the outer snapshot would not
-- see the rows it inserts anyway.
create temporary table t_sync1 as
  select * from public.sync_automatic_tasks((select today from t_day));

select is(
  (select count(*)::int from t_sync1 s
    join public.tasks t on t.id = s.task_id
   where t.source_id = '00000000-0000-0000-0000-0000000007c1' and s.change = 'created'),
  1,
  'a document expiring within 30 days gets a task'
);

select is(
  (select count(*)::int from public.tasks
    where source_id = '00000000-0000-0000-0000-0000000007c2'),
  0,
  'a document expiring later gets none'
);

select results_eq(
  $$select title, due_date, origin, status from public.tasks
     where source_id = '00000000-0000-0000-0000-0000000007c1'$$,
  $$values ('Renovar vtv de TK001AA'::text, (select today from t_day) + 10, 'automatic'::text, 'open'::text)$$,
  'the task names the document and is due when it expires'
);

select is(
  (select count(*)::int from public.sync_automatic_tasks((select today from t_day)) s
   where s.task_id = (select id from public.tasks
                       where source_id = '00000000-0000-0000-0000-0000000007c1')),
  0,
  'a second run with nothing changed touches nothing'
);

select is(
  (select count(*)::int from public.tasks
    where source_table = 'fleet_documents'
      and source_id = '00000000-0000-0000-0000-0000000007c1'),
  1,
  'the sync never duplicates a task'
);

-- Renewed: the document leaves the window and the task closes by itself.
update public.fleet_documents set expires_at = (select today from t_day) + 365
 where id = '00000000-0000-0000-0000-0000000007c1';
select public.sync_automatic_tasks((select today from t_day));

select results_eq(
  $$select status, auto_closed, completed_by is null from public.tasks
     where source_id = '00000000-0000-0000-0000-0000000007c1'$$,
  $$values ('done'::text, true, true)$$,
  'a settled document closes its task'
);

-- Back in the window: the sync opens what it closed.
update public.fleet_documents set expires_at = (select today from t_day) + 5
 where id = '00000000-0000-0000-0000-0000000007c1';
select public.sync_automatic_tasks((select today from t_day));

select results_eq(
  $$select status, auto_closed, due_date from public.tasks
     where source_id = '00000000-0000-0000-0000-0000000007c1'$$,
  $$values ('open'::text, false, (select today from t_day) + 5)$$,
  'a document that needs action again reopens the task the sync closed'
);

-- A user's due date survives the document's.
update public.tasks
   set due_date = (select today from t_day) + 2, due_date_locked = true
 where source_id = '00000000-0000-0000-0000-0000000007c1';
update public.fleet_documents set expires_at = (select today from t_day) + 6
 where id = '00000000-0000-0000-0000-0000000007c1';
select public.sync_automatic_tasks((select today from t_day));

select is(
  (select due_date from public.tasks
    where source_id = '00000000-0000-0000-0000-0000000007c1'),
  (select today from t_day) + 2,
  'the sync keeps a due date a user moved'
);

-- A user's close survives the sync, even with the document still pending.
update public.tasks
   set status = 'done', completed_at = now(),
       completed_by = '00000000-0000-0000-0000-0000000007a1'
 where source_id = '00000000-0000-0000-0000-0000000007c1';
select public.sync_automatic_tasks((select today from t_day));

select is(
  (select status from public.tasks
    where source_id = '00000000-0000-0000-0000-0000000007c1'),
  'done',
  'the sync does not reopen a task a user closed'
);

-- An own check due this week, then cashed.
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000000007d1', 'Banco tareas', 'bank', 'ARS');
insert into public.issued_checks
  (id, kind, check_number, bank_name, issue_date, due_date, amount, currency,
   bank_account_id, channel_id)
values
  ('00000000-0000-0000-0000-0000000007e1', 'fisico', 'TK-1', 'Banco tareas',
   (select today from t_day), (select today from t_day) + 3, 100, 'ARS',
   '00000000-0000-0000-0000-0000000007d1', 'jouve_fiscal');
select public.sync_automatic_tasks((select today from t_day));

select is(
  (select kind from public.tasks
    where source_id = '00000000-0000-0000-0000-0000000007e1'),
  'issued_check',
  'an own check due within 7 days gets a task'
);

-- 3. Identity guard ----------------------------------------------------------------------

select throws_ok(
  $$update public.tasks set source_id = gen_random_uuid()
     where source_id = '00000000-0000-0000-0000-0000000007e1'$$,
  '23514',
  'El origen de una tarea no se puede cambiar.',
  'a task never changes what it is about'
);

select throws_ok(
  $$insert into public.tasks (title, origin, source_table, source_id, kind)
    values ('x', 'automatic', 'fleet_documents', gen_random_uuid(), 'collection')$$,
  '23514',
  null,
  'a source table only pairs with its own kind'
);

-- 4. Recurring occurrences ------------------------------------------------------------------

insert into public.recurring_tasks (id, title, day_of_month) values
  ('00000000-0000-0000-0000-0000000007f1', 'Cierre de mes',
   extract(day from (select today from t_day))::int);
insert into public.recurring_task_assignees (recurring_task_id, user_id) values
  ('00000000-0000-0000-0000-0000000007f1', '00000000-0000-0000-0000-0000000007a2');

select cmp_ok(
  public.materialize_recurring_tasks((select today from t_day)),
  '>=',
  1,
  'an occurrence due today is created'
);

select is(
  public.materialize_recurring_tasks((select today from t_day)),
  0,
  'materializing again creates nothing'
);

select results_eq(
  $$select t.due_date, t.origin, a.user_id from public.tasks t
     join public.task_assignees a on a.task_id = t.id
    where t.recurring_task_id = '00000000-0000-0000-0000-0000000007f1'$$,
  $$values ((select today from t_day), 'recurring'::text,
            '00000000-0000-0000-0000-0000000007a2'::uuid)$$,
  'the occurrence is due on its day and goes to the recurrence''s assignees'
);

-- 5. RLS -------------------------------------------------------------------------------------

insert into public.tasks (id, title, origin) values
  ('00000000-0000-0000-0000-000000000701', 'Llamar al cliente', 'manual');

set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000007a3","role":"authenticated"}', true);
select results_eq(
  $$select count(*)::int from public.tasks
     where id = '00000000-0000-0000-0000-000000000701'
        or source_table = 'fleet_documents'$$,
  $$values (1)$$,
  'warehouse sees manual tasks but not a fleet document''s'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.tasks
    where source_id in ('00000000-0000-0000-0000-0000000007c1',
                        '00000000-0000-0000-0000-0000000007e1')),
  1,
  'operations sees the fleet task, not the own check''s'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000007a2","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.tasks
    where source_id in ('00000000-0000-0000-0000-0000000007c1',
                        '00000000-0000-0000-0000-0000000007e1')),
  1,
  'finance sees the own check''s task, not the fleet one'
);

select lives_ok(
  $$insert into public.tasks (title, origin, created_by)
    values ('Pagar el alquiler', 'manual', '00000000-0000-0000-0000-0000000007a2')$$,
  'a task role creates a manual task'
);

select throws_ok(
  $$insert into public.tasks (title, origin, source_table, source_id, kind)
    values ('x', 'automatic', 'issued_checks', gen_random_uuid(), 'issued_check')$$,
  '42501',
  null,
  'nobody creates an automatic task through the API'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000007a4","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.tasks),
  0,
  'a driver sees no task'
);

select throws_ok(
  $$insert into public.task_comments (task_id, author_id, body)
    values ('00000000-0000-0000-0000-000000000701',
            '00000000-0000-0000-0000-0000000007a4', 'hola')$$,
  '42501',
  null,
  'a driver cannot comment'
);

reset role;

select * from finish(true);

rollback;
