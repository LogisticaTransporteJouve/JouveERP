SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Per-user access: the owner can deny single permissions to a user on top of
-- the user's roles. Denies are enforced at the application gate
-- (lib/auth: userCan over the user's effective access); RLS keeps enforcing
-- the role ceiling, so a deny is not a barrier against direct API access with
-- the user's own token. docs/decisions.md records why.

------------------------------------------------------------------------------
-- 1. user_permission_denies
------------------------------------------------------------------------------
create table public.user_permission_denies (
  user_id uuid not null references auth.users (id) on delete cascade,
  permission text not null check (permission ~ '^[a-z_]+:[a-z_]+$'),
  reason text,
  -- Unindexed on purpose: the table holds at most a few rows per user.
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, permission)
);

comment on table public.user_permission_denies is
  'Permissions denied to a user on top of their roles. Read by lib/auth; written only by public.set_user_access.';

alter table public.user_permission_denies enable row level security;

-- A user reads their own denies (lib/auth/context.ts loads them with the
-- user's client); owner and admin, who hold users:read, read everyone's.
create policy "Users read own denies; owner and admin read all"
  on public.user_permission_denies
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.user_has_role(array['owner', 'admin']))
  );

revoke all on public.user_permission_denies from public, anon, authenticated;
grant select on public.user_permission_denies to authenticated;
grant select, insert, delete on public.user_permission_denies to service_role;

------------------------------------------------------------------------------
-- 2. set_user_access: the one writer of user_roles edits and denies
------------------------------------------------------------------------------
-- Called only by the service role from features/admin-users, after the action
-- checked users:assign_role / users:manage_access; so p_actor and the role
-- lists are trusted. A null p_roles or p_denied leaves that part unchanged; a
-- non-null p_expected_* that differs from the stored rows means someone else
-- saved first. Errcodes: UA001 self edit, UA002 stale, UA003 role not
-- assignable; the last-owner trigger raises 23514 at commit.
create function public.set_user_access(
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

  v_final_roles := coalesce(p_roles, v_current_roles);

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
    v_final_denied := coalesce(p_denied, v_current_denied);
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

------------------------------------------------------------------------------
-- 3. search_global: callers narrow the entity types
------------------------------------------------------------------------------
-- The action passes the types the caller's effective access may read; the
-- role CASE stays the ceiling, so p_types can only narrow. The defaults keep a
-- two-argument call (code deployed before this migration, or a rollback)
-- resolving to this function.
drop function public.search_global(text, integer);

create function public.search_global(
  p_query text,
  p_limit int default 20,
  p_types text[] default null
)
returns table (
  entity_type text,
  entity_id   text,
  title       text,
  subtitle    text,
  url         text,
  rank        real
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select websearch_to_tsquery('spanish', p_query) as tsq
  ),
  caller_roles as (
    select array_agg(role_id) as roles
      from public.user_roles
     where user_id = auth.uid()
  ),
  allowed_types as (
    select case
      when (select roles from caller_roles) && array['owner', 'admin', 'finance']
        then array['client', 'supplier', 'invoice', 'purchase_invoice',
                   'receipt', 'payment_order', 'transaction']
      when (select roles from caller_roles) && array['operations']
        then array['client', 'supplier']
      else array[]::text[]
    end as types
  )
  select
    s.entity_type, s.entity_id, s.title, s.subtitle, s.url,
    ts_rank(s.tsv, q.tsq) as rank
  from public.search_index s, q, allowed_types a
  where s.tsv @@ q.tsq
    and s.entity_type = any (a.types)
    and (p_types is null or s.entity_type = any (p_types))
  order by rank desc, s.title asc
  limit greatest(1, least(p_limit, 50));
$$;

comment on function public.search_global(text, integer, text[]) is
  'Global search (SECURITY DEFINER). Role->entity map mirrors lib/auth/permissions.ts: owner/admin/finance = all; operations = client+supplier; warehouse/driver = none. p_types narrows it to what the caller''s effective access may read.';

revoke all on function public.search_global(text, integer, text[]) from public, anon, authenticated;
grant execute on function public.search_global(text, integer, text[]) to authenticated;
