-- B.1 — RBAC foundation: roles catalog, user_roles, audit_events, helper.
--
-- Notes:
-- * `row_security` is dropped while we seed the roles catalog so the seed
--   inserts succeed before any policies exist on the table. RLS is enabled
--   immediately afterwards.
-- * `public.user_has_role` wraps `(select auth.uid())` so RLS policies can
--   call it without re-evaluating auth.uid() per row.
-- * The "at least one active owner" rule is enforced by a deferrable
--   constraint trigger so multi-statement transactions (revoke + grant) can
--   pass through an intermediate state where the count is briefly zero.

set row_security = off;

------------------------------------------------------------------------------
-- 1. roles catalog
------------------------------------------------------------------------------
create table public.roles (
  id           text primary key,
  display_name text not null,
  description  text,
  rank         smallint not null,
  created_at   timestamptz not null default now()
);

comment on table  public.roles is 'Catalog of role identifiers used across JouveERP.';
comment on column public.roles.rank is 'Ordering for UI; lower = more privileged.';

insert into public.roles (id, display_name, description, rank) values
  ('owner',      'Owner',      'Full access. Can grant any role.',                       0),
  ('admin',      'Admin',      'Full access except changing the owner set.',             1),
  ('finance',    'Finance',    'Manages clients, accounts, transactions, and invoices.', 2),
  ('operations', 'Operations', 'Manages day-to-day operations, fleet, and warehouse.',   3),
  ('warehouse',  'Warehouse',  'Manages pallets and warehouse movements.',               4),
  ('driver',     'Driver',     'Driver-level access. :own scoping arrives in Phase G.',  5);

alter table public.roles enable row level security;

create policy "Authenticated users can read roles"
  on public.roles for select
  to authenticated
  using (true);

------------------------------------------------------------------------------
-- 2. user_roles
------------------------------------------------------------------------------
create table public.user_roles (
  user_id    uuid not null references auth.users (id) on delete cascade,
  role_id    text not null references public.roles (id),
  granted_by uuid     references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

comment on table public.user_roles is 'Roles granted to a user. A user may hold multiple roles.';

create index user_roles_role_id_idx on public.user_roles (role_id);

alter table public.user_roles enable row level security;

------------------------------------------------------------------------------
-- 3. audit_events
------------------------------------------------------------------------------
create table public.audit_events (
  id                  uuid primary key default gen_random_uuid(),
  ts                  timestamptz not null default now(),
  actor_id            uuid     references auth.users (id) on delete set null,
  event_type          text not null,
  target_user_id      uuid     references auth.users (id) on delete set null,
  target_resource_id  text,
  payload             jsonb not null default '{}'::jsonb,
  ip_address          inet,
  user_agent          text
);

comment on table public.audit_events is 'Append-only log of privileged actions for compliance review.';

create index audit_events_ts_idx        on public.audit_events (ts desc);
create index audit_events_actor_id_idx  on public.audit_events (actor_id);
create index audit_events_event_type_idx on public.audit_events (event_type);

alter table public.audit_events enable row level security;

------------------------------------------------------------------------------
-- 4. user_has_role helper
------------------------------------------------------------------------------
create or replace function public.user_has_role(p_role_ids text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = (select auth.uid())
      and ur.role_id = any (p_role_ids)
  );
$$;

revoke all on function public.user_has_role(text[]) from public;
grant execute on function public.user_has_role(text[]) to authenticated;

comment on function public.user_has_role(text[]) is
  'True when the current auth.uid() holds any of the given role ids. Use inside RLS policies.';

------------------------------------------------------------------------------
-- 5. RLS policies
------------------------------------------------------------------------------

-- user_roles: a user can read its own row, owner/admin can read all.
create policy "Users can view their own role assignments"
  on public.user_roles for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Owners and admins can view all role assignments"
  on public.user_roles for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin']));

-- user_roles writes are restricted to owner and admin. The deferrable trigger
-- below blocks the case where an owner accidentally revokes the last owner.
create policy "Owners and admins can grant roles"
  on public.user_roles for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'admin']));

create policy "Owners and admins can revoke roles"
  on public.user_roles for delete
  to authenticated
  using (public.user_has_role(array['owner', 'admin']));

-- audit_events: read is owner/admin only; inserts come exclusively from the
-- service role (no public insert policy).
create policy "Owners and admins can view audit events"
  on public.audit_events for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin']));

------------------------------------------------------------------------------
-- 6. "at least one active owner" deferrable constraint
------------------------------------------------------------------------------
create or replace function public.user_roles_enforce_owner_minimum()
returns trigger
language plpgsql
as $$
declare
  active_owners int;
begin
  select count(*) into active_owners
  from public.user_roles
  where role_id = 'owner';

  if active_owners = 0 then
    raise exception 'At least one user must hold the owner role.'
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

create constraint trigger user_roles_owner_minimum_trigger
  after delete or update of role_id on public.user_roles
  deferrable initially deferred
  for each row
  execute function public.user_roles_enforce_owner_minimum();

set row_security = on;
