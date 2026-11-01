SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- One row per run of the ARCA issued-voucher import (Inngest
-- `arca-issued-sync`, hourly cron or the "Traer de ARCA" button). Lets the UI
-- know whether an import is running, resume its progress toast after a
-- reload and disable the button meanwhile. Written only by the job through
-- the service role.
create table public.arca_sync_runs (
  id           uuid primary key default gen_random_uuid(),
  trigger      text not null check (trigger in ('cron', 'manual')),
  requested_by uuid references auth.users (id) on delete set null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  imported     integer not null default 0 check (imported >= 0),
  error        text
);

create index arca_sync_runs_started_at_idx on public.arca_sync_runs (started_at desc);
create index arca_sync_runs_requested_by_idx on public.arca_sync_runs (requested_by);

alter table public.arca_sync_runs enable row level security;

-- Aligned with afip:admin in lib/auth/permissions.ts (owner, admin).
create policy "Owner and admin view ARCA sync runs" on public.arca_sync_runs
  for select to authenticated
  using ( (select public.user_has_role(array['owner', 'admin'])) );

revoke all on table public.arca_sync_runs from public, anon, authenticated;
grant select on table public.arca_sync_runs to authenticated;
grant all on table public.arca_sync_runs to service_role;
