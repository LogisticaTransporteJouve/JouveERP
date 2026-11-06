-- Tasks and recurring tasks written with their assignees in one transaction
-- (20261106111002): set_task_assignees replaces the set and reports the
-- difference; create_task and create_recurring_task write the row and its
-- assignees together or not at all; update_recurring_task patches only the
-- keys it is given. Service role only. One transaction, rolled back.

begin;

select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000008a1', 'a@task-writes.test'),
  ('00000000-0000-0000-0000-0000000008a2', 'b@task-writes.test'),
  ('00000000-0000-0000-0000-0000000008a3', 'c@task-writes.test');

select ok(
  not has_function_privilege('authenticated', 'public.set_task_assignees(uuid, uuid[], uuid)', 'execute')
  and not has_function_privilege('anon', 'public.set_task_assignees(uuid, uuid[], uuid)', 'execute')
  and has_function_privilege('service_role', 'public.set_task_assignees(uuid, uuid[], uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.create_task(uuid, text, uuid[], text, date)', 'execute')
  and has_function_privilege('service_role', 'public.create_task(uuid, text, uuid[], text, date)', 'execute')
  and not has_function_privilege('authenticated', 'public.create_recurring_task(uuid, text, integer, uuid[], text)', 'execute')
  and has_function_privilege('service_role', 'public.create_recurring_task(uuid, text, integer, uuid[], text)', 'execute')
  and not has_function_privilege('authenticated', 'public.update_recurring_task(uuid, jsonb, uuid[])', 'execute')
  and has_function_privilege('service_role', 'public.update_recurring_task(uuid, jsonb, uuid[])', 'execute'),
  'only the service role runs the task writers'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- 1. create_task ---------------------------------------------------------------------

create temporary table t_task as
  select public.create_task(
    '00000000-0000-0000-0000-0000000008a1', 'Llamar al cliente',
    array['00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-0000000008a2']::uuid[],
    p_due_date => '2026-11-10') as id;

select results_eq(
  $$select t.origin, t.created_by, t.due_date, t.description
      from public.tasks t where t.id = (select id from t_task)$$,
  $$values ('manual'::text, '00000000-0000-0000-0000-0000000008a1'::uuid, '2026-11-10'::date, null::text)$$,
  'create_task writes a manual task by the actor'
);

select results_eq(
  $$select user_id, assigned_by from public.task_assignees
     where task_id = (select id from t_task) order by user_id$$,
  $$values ('00000000-0000-0000-0000-0000000008a1'::uuid, '00000000-0000-0000-0000-0000000008a1'::uuid),
           ('00000000-0000-0000-0000-0000000008a2'::uuid, '00000000-0000-0000-0000-0000000008a1'::uuid)$$,
  'and its assignees, assigned by the actor'
);

select throws_ok(
  $$select public.create_task('00000000-0000-0000-0000-0000000008a1', 'Huérfana',
      array['00000000-0000-0000-0000-0000000008ff']::uuid[])$$,
  '23503',
  null,
  'an assignee that does not exist fails the create'
);

select is(
  (select count(*)::int from public.tasks where title = 'Huérfana'),
  0,
  'and leaves no task behind'
);

-- 2. set_task_assignees --------------------------------------------------------------

update public.task_assignees set assigned_at = '2026-01-01'
 where task_id = (select id from t_task);

select results_eq(
  $$select added, removed from public.set_task_assignees(
      (select id from t_task),
      array['00000000-0000-0000-0000-0000000008a2', '00000000-0000-0000-0000-0000000008a3']::uuid[],
      '00000000-0000-0000-0000-0000000008a3')$$,
  $$values (array['00000000-0000-0000-0000-0000000008a3']::uuid[],
            array['00000000-0000-0000-0000-0000000008a1']::uuid[])$$,
  'set_task_assignees reports who was added and who removed'
);

select results_eq(
  $$select user_id, assigned_by, assigned_at = '2026-01-01' from public.task_assignees
     where task_id = (select id from t_task) order by user_id$$,
  $$values ('00000000-0000-0000-0000-0000000008a2'::uuid, '00000000-0000-0000-0000-0000000008a1'::uuid, true),
           ('00000000-0000-0000-0000-0000000008a3'::uuid, '00000000-0000-0000-0000-0000000008a3'::uuid, false)$$,
  'the kept assignee is untouched, the new one is assigned by the actor'
);

select throws_ok(
  $$select * from public.set_task_assignees((select id from t_task),
      array['00000000-0000-0000-0000-0000000008ff']::uuid[], '00000000-0000-0000-0000-0000000008a1')$$,
  '23503',
  null,
  'a failed add fails the whole replace'
);

select is(
  (select array_agg(user_id order by user_id) from public.task_assignees
    where task_id = (select id from t_task)),
  array['00000000-0000-0000-0000-0000000008a2', '00000000-0000-0000-0000-0000000008a3']::uuid[],
  'and keeps the assignees the task had: none removed'
);

select throws_ok(
  $$select * from public.set_task_assignees('00000000-0000-0000-0000-0000000008ee',
      '{}'::uuid[], '00000000-0000-0000-0000-0000000008a1')$$,
  'P0002',
  'La tarea no existe.',
  'set_task_assignees on a missing task says so'
);

-- 3. Recurring tasks -----------------------------------------------------------------

create temporary table t_recurring as
  select public.create_recurring_task(
    '00000000-0000-0000-0000-0000000008a1', 'Cierre de mes', 1,
    array['00000000-0000-0000-0000-0000000008a1']::uuid[], 'Detalle') as id;

select results_eq(
  $$select r.title, r.description, r.day_of_month, r.created_by,
           (select array_agg(a.user_id) from public.recurring_task_assignees a
             where a.recurring_task_id = r.id)
      from public.recurring_tasks r where r.id = (select id from t_recurring)$$,
  $$values ('Cierre de mes'::text, 'Detalle'::text, 1, '00000000-0000-0000-0000-0000000008a1'::uuid,
            array['00000000-0000-0000-0000-0000000008a1']::uuid[])$$,
  'create_recurring_task writes the recurrence and its assignees'
);

select throws_ok(
  $$select public.update_recurring_task((select id from t_recurring),
      '{"title":"Cierre","description":null}',
      array['00000000-0000-0000-0000-0000000008ff']::uuid[])$$,
  '23503',
  null,
  'an update whose assignees fail is refused whole'
);

select ok(
  public.update_recurring_task((select id from t_recurring),
    '{"description":null,"day_of_month":5}',
    array['00000000-0000-0000-0000-0000000008a2']::uuid[]),
  'update_recurring_task patches an existing recurrence'
);

select results_eq(
  $$select r.title, r.description, r.day_of_month, r.is_active,
           (select array_agg(a.user_id) from public.recurring_task_assignees a
             where a.recurring_task_id = r.id)
      from public.recurring_tasks r where r.id = (select id from t_recurring)$$,
  $$values ('Cierre de mes'::text, null::text, 5, true,
            array['00000000-0000-0000-0000-0000000008a2']::uuid[])$$,
  'only the keys sent change (a null description clears it), and the assignees are the new set'
);

select * from finish();
rollback;
