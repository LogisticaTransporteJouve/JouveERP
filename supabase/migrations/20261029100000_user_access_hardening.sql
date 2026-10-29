SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Hardening of 20261028140000_user_permission_denies:
-- * set_user_access refuses any caller but the service role, and ignores
--   duplicate roles or denies in its input instead of failing on the key.
-- * search_global resolves nothing through the search path (its body is
--   already schema-qualified).

-- assignable; the last-owner trigger raises 23514 at commit.
create or replace function public.set_user_access(
  p_actor uuid,
  p_user_id uuid,
  p_roles text[] default null,
  p_denied text[] default null,
  p_addable_roles text[] default '{}',
  p_removable_roles text[] default '{}',
  p_expected_roles text[] default null,
  p_expected_denied text[] default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_roles text[];
  v_current_denied text[];
  v_final_roles text[];
  v_final_denied text[];
  v_added text[];
  v_removed text[];
  v_denied_added text[];
  v_denied_removed text[];
begin
  -- p_actor and the role lists are trusted, so only the service role may call
  -- this, whatever the grants say.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'set_user_access is for the service role' using errcode = '42501';
  end if;

  if p_actor = p_user_id then
    raise exception 'users cannot edit their own access' using errcode = 'UA001';
  end if;

  perform pg_advisory_xact_lock(hashtext('user_access:' || p_user_id::text));

  select coalesce(array_agg(role_id order by role_id), '{}')
    into v_current_roles
    from public.user_roles
   where user_id = p_user_id;

  select coalesce(array_agg(permission order by permission), '{}')
    into v_current_denied
    from public.user_permission_denies
   where user_id = p_user_id;

  if (p_expected_roles is not null
        and not (p_expected_roles @> v_current_roles and v_current_roles @> p_expected_roles))
     or (p_expected_denied is not null
        and not (p_expected_denied @> v_current_denied and v_current_denied @> p_expected_denied)) then
    raise exception 'access changed since it was loaded' using errcode = 'UA002';
  end if;

  v_final_roles := array(select distinct r from unnest(coalesce(p_roles, v_current_roles)) r);

  select coalesce(array_agg(r), '{}') into v_added
    from unnest(v_final_roles) r
   where not r = any (v_current_roles);
  select coalesce(array_agg(r), '{}') into v_removed
    from unnest(v_current_roles) r
   where not r = any (v_final_roles);

  if not coalesce(p_addable_roles, '{}') @> v_added
     or not coalesce(p_removable_roles, '{}') @> v_removed then
    raise exception 'role change not allowed for this actor' using errcode = 'UA003';
  end if;

  -- Two owners demoting each other concurrently would each see the other as
  -- the remaining owner; serialize every change to the owner set.
  if 'owner' = any (v_added) or 'owner' = any (v_removed) then
    perform pg_advisory_xact_lock(hashtext('user_access:owners'));
  end if;

  -- The owner holds every permission and cannot be denied any.
  if 'owner' = any (v_final_roles) then
    v_final_denied := '{}';
  else
    v_final_denied := array(select distinct d from unnest(coalesce(p_denied, v_current_denied)) d);
  end if;

  select coalesce(array_agg(d), '{}') into v_denied_added
    from unnest(v_final_denied) d
   where not d = any (v_current_denied);
  select coalesce(array_agg(d), '{}') into v_denied_removed
    from unnest(v_current_denied) d
   where not d = any (v_final_denied);

  if cardinality(v_added) > 0 then
    insert into public.user_roles (user_id, role_id, granted_by)
    select p_user_id, r, p_actor from unnest(v_added) r;
  end if;
  if cardinality(v_removed) > 0 then
    delete from public.user_roles
     where user_id = p_user_id and role_id = any (v_removed);
  end if;
  if cardinality(v_denied_added) > 0 then
    insert into public.user_permission_denies (user_id, permission, created_by)
    select p_user_id, d, p_actor from unnest(v_denied_added) d;
  end if;
  if cardinality(v_denied_removed) > 0 then
    delete from public.user_permission_denies
     where user_id = p_user_id and permission = any (v_denied_removed);
  end if;

  if cardinality(v_added) > 0 or cardinality(v_removed) > 0 then
    insert into public.audit_events (actor_id, event_type, target_user_id, payload)
    values (p_actor, 'user.roles.updated', p_user_id,
            jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed)));
  end if;
  if cardinality(v_denied_added) > 0 or cardinality(v_denied_removed) > 0 then
    insert into public.audit_events (actor_id, event_type, target_user_id, payload)
    values (p_actor, 'user.access.updated', p_user_id,
            jsonb_build_object('denied_added', to_jsonb(v_denied_added),
                               'denied_removed', to_jsonb(v_denied_removed)));
  end if;
end;
$$;

revoke all on function public.set_user_access(uuid, uuid, text[], text[], text[], text[], text[], text[])
  from public, anon, authenticated;
grant execute on function public.set_user_access(uuid, uuid, text[], text[], text[], text[], text[], text[])
  to service_role;

alter function public.search_global(text, integer, text[]) set search_path = '';
