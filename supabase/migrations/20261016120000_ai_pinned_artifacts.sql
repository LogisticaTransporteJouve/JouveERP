-- AI CFO phase 3 — charts and tables a user pins from the assistant.
--
-- A pin stores what rebuilds the artifact, never its data: the registry read
-- action, its validated input and the chart or table config. Viewing a pin
-- re-runs that action as the viewer, with the permissions they hold then, so
-- a user who loses access to the data stops seeing it.
--
-- Writes go only through the service client, after the server action has
-- checked `ai:chat` plus the source action's own permissions and filtered by
-- the caller's user id; `authenticated` can only read its own rows.

set row_security = off;

create table public.ai_pinned_artifacts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('chart', 'table')),
  title       text not null check (char_length(title) between 1 and 120),
  action      text not null check (char_length(action) between 1 and 80),
  input       jsonb not null default '{}'::jsonb,
  config      jsonb not null,
  created_at  timestamptz not null default now()
);

comment on table public.ai_pinned_artifacts is
  'Gráficos y tablas del asistente de IA fijados por un usuario. Guarda la consulta (acción + input) y la configuración, no los datos: se recalcula al verlo con los permisos vigentes.';

create index ai_pinned_artifacts_user_idx
  on public.ai_pinned_artifacts (user_id, created_at desc);

-- The same query with the same config is pinned once per user (jsonb::text
-- is canonical, so key order does not matter).
create unique index ai_pinned_artifacts_unique_idx
  on public.ai_pinned_artifacts (user_id, action, md5(input::text || config::text));

-- At most 30 pins per user (ARTIFACT_LIMITS.pinsPerUser). The per-user lock
-- serializes concurrent inserts, so two requests cannot both pass the count.
create function public.ai_pinned_artifacts_enforce_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_pinned_artifacts:' || new.user_id::text, 0));
  if (select count(*) from public.ai_pinned_artifacts where user_id = new.user_id) >= 30 then
    raise exception 'ai_pinned_artifacts: pin limit reached'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.ai_pinned_artifacts_enforce_cap() from public, anon, authenticated;

create trigger ai_pinned_artifacts_enforce_cap
  before insert on public.ai_pinned_artifacts
  for each row execute function public.ai_pinned_artifacts_enforce_cap();

alter table public.ai_pinned_artifacts enable row level security;

-- Own rows only, for the roles that hold ai:chat (lib/auth/permissions.ts).
create policy "ai_pinned_artifacts select"
  on public.ai_pinned_artifacts for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.user_has_role(array['owner', 'admin', 'finance', 'operations']))
  );

revoke all on table public.ai_pinned_artifacts from anon, authenticated;
grant select on table public.ai_pinned_artifacts to authenticated;

set row_security = on;
