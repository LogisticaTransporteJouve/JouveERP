-- Atomic first-owner bootstrap.
--
-- bootstrapOwnerIfNeeded used to be an exported "use server" action (so a
-- POST endpoint callable by any signed-in user) that did count(owners) and
-- then insert(owner) in two round-trips: any user could self-promote while no
-- owner existed, and two concurrent calls could both promote.
--
-- This function does the check and the insert in one transaction under an
-- advisory lock, and only promotes the earliest-created auth user, so at most
-- one user ever becomes owner through this path. It writes the audit event in
-- the same transaction. It is executable only by service_role: the app calls
-- it from a server-only module after requireUserContext(), never from a
-- server action.

create or replace function public.bootstrap_first_owner(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first_user uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'No autorizado para inicializar el owner'
      using errcode = '42501';
  end if;

  -- Serializes concurrent bootstraps; released at commit. The check below
  -- runs after the lock is held, so it sees any owner a previous holder
  -- committed.
  perform pg_advisory_xact_lock(hashtext('public.bootstrap_first_owner'));

  if exists (select 1 from public.user_roles where role_id = 'owner') then
    return false;
  end if;

  select u.id
    into v_first_user
    from auth.users u
   order by u.created_at, u.id
   limit 1;

  if p_user_id is null or p_user_id is distinct from v_first_user then
    return false;
  end if;

  insert into public.user_roles (user_id, role_id, granted_by)
  values (p_user_id, 'owner', p_user_id);

  insert into public.audit_events (actor_id, event_type, target_user_id, payload)
  values (
    p_user_id,
    'user.role.granted',
    p_user_id,
    jsonb_build_object('role', 'owner', 'reason', 'bootstrap')
  );

  return true;
end;
$$;

revoke all on function public.bootstrap_first_owner(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_first_owner(uuid) to service_role;
