SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Tasks and recurring tasks written with their assignees in one transaction.
-- The actions used to write them in separate statements:
--   * setTaskAssigneesAction deleted the removed assignees, then upserted the
--     added ones: a failed upsert left the task with fewer people and none of
--     the new ones;
--   * updateRecurringTaskAction saved the fields, deleted every assignee and
--     inserted the new set: a failed insert left the recurrence with nobody;
--   * createTask (lib/commands/create-task.ts) and createRecurringTaskAction
--     inserted the row, then its assignees, and deleted the row by hand when
--     those failed; a failed delete left it with nobody.
--
--   set_task_assignees      the task's assignees become p_assignee_ids: the
--                           others are removed, the new ones added with
--                           assigned_by p_actor, the ones kept untouched.
--                           Locks the task first, so it runs after a
--                           concurrent reassignment or the tasks-daily
--                           default assignment, not interleaved with it.
--                           Returns who was added and who removed.
--   create_task             a manual task and its assignees (through
--                           set_task_assignees).
--   create_recurring_task   a recurrence and its assignees.
--   update_recurring_task   the fields present in p_patch and, when
--                           p_assignee_ids is not null, the assignees.
--                           False when there is no such recurrence.
--
-- The actions check tasks:write and that every new assignee holds tasks:read
-- (features/tasks/lib/assignees.ts) and call these through the service
-- client, as they wrote the tables before: service role only, SECURITY
-- INVOKER, the actor passed in.
--
-- Rollback: older code does not call them and writes the tables itself.

create function public.set_task_assignees(
  p_task_id      uuid,
  p_assignee_ids uuid[],
  p_actor        uuid
)
returns table (added uuid[], removed uuid[])
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_before uuid[];
  v_after  uuid[] := coalesce(p_assignee_ids, '{}');
begin
  perform 1 from public.tasks t where t.id = p_task_id for update;
  if not found then
    raise exception 'La tarea no existe.'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;

  select coalesce(array_agg(a.user_id), '{}') into v_before
    from public.task_assignees a
   where a.task_id = p_task_id;

  delete from public.task_assignees a
   where a.task_id = p_task_id
     and not (a.user_id = any (v_after));

  insert into public.task_assignees (task_id, user_id, assigned_by)
  select distinct p_task_id, u, p_actor
    from unnest(v_after) u
  on conflict (task_id, user_id) do nothing;

  return query select
    coalesce((select array_agg(distinct u) from unnest(v_after) u
               where not (u = any (v_before))), '{}'),
    coalesce((select array_agg(b) from unnest(v_before) b
               where not (b = any (v_after))), '{}');
end;
$$;

create function public.create_task(
  p_actor        uuid,
  p_title        text,
  p_assignee_ids uuid[],
  p_description  text default null,
  p_due_date     date default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.tasks (title, description, due_date, origin, created_by)
  values (p_title, p_description, p_due_date, 'manual', p_actor)
  returning id into v_id;

  perform public.set_task_assignees(v_id, p_assignee_ids, p_actor);
  return v_id;
end;
$$;

create function public.create_recurring_task(
  p_actor        uuid,
  p_title        text,
  p_day_of_month integer,
  p_assignee_ids uuid[],
  p_description  text default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.recurring_tasks (title, description, day_of_month, created_by)
  values (p_title, p_description, p_day_of_month, p_actor)
  returning id into v_id;

  insert into public.recurring_task_assignees (recurring_task_id, user_id)
  select distinct v_id, u
    from unnest(coalesce(p_assignee_ids, '{}')) u;
  return v_id;
end;
$$;

create function public.update_recurring_task(
  p_id           uuid,
  p_patch        jsonb,
  p_assignee_ids uuid[] default null
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'update_recurring_task: p_patch must be a jsonb object';
  end if;

  update public.recurring_tasks r
     set title        = case when p_patch ? 'title'
                             then p_patch ->> 'title' else r.title end,
         description  = case when p_patch ? 'description'
                             then p_patch ->> 'description' else r.description end,
         day_of_month = case when p_patch ? 'day_of_month'
                             then (p_patch ->> 'day_of_month')::integer else r.day_of_month end,
         is_active    = case when p_patch ? 'is_active'
                             then (p_patch ->> 'is_active')::boolean else r.is_active end
   where r.id = p_id;
  if not found then
    return false;
  end if;

  if p_assignee_ids is not null then
    delete from public.recurring_task_assignees a
     where a.recurring_task_id = p_id
       and not (a.user_id = any (p_assignee_ids));
    insert into public.recurring_task_assignees (recurring_task_id, user_id)
    select distinct p_id, u
      from unnest(p_assignee_ids) u
    on conflict (recurring_task_id, user_id) do nothing;
  end if;
  return true;
end;
$$;

revoke all on function public.set_task_assignees(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.set_task_assignees(uuid, uuid[], uuid) to service_role;
revoke all on function public.create_task(uuid, text, uuid[], text, date) from public, anon, authenticated;
grant execute on function public.create_task(uuid, text, uuid[], text, date) to service_role;
revoke all on function public.create_recurring_task(uuid, text, integer, uuid[], text) from public, anon, authenticated;
grant execute on function public.create_recurring_task(uuid, text, integer, uuid[], text) to service_role;
revoke all on function public.update_recurring_task(uuid, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.update_recurring_task(uuid, jsonb, uuid[]) to service_role;
