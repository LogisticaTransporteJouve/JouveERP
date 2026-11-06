SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- One row per «Aceptar todos los pendientes» in Compras › Recibidos de ARCA
-- (Inngest `arca-bulk-accept`): creates the missing suppliers from padrón,
-- loads every pending voucher as a purchase and settles up to the opening
-- date with an opening balance at 0. The tray polls the latest row for its
-- phase and counts. Inserted by the owner's server action and written by the
-- job, both through the service role.
--
-- Rollback: older code never reads or writes this table.
create table public.arca_bulk_accept_runs (
  id           uuid primary key default gen_random_uuid(),
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  phase        text not null default 'queued'
    check (phase in ('queued', 'suppliers', 'vouchers', 'opening_balances', 'done', 'failed')),
  progress     jsonb not null default '{}'::jsonb,
  error        text
);

-- One run at a time: a second request while one is open is refused.
create unique index arca_bulk_accept_runs_one_open_idx
  on public.arca_bulk_accept_runs ((true)) where finished_at is null;
create index arca_bulk_accept_runs_requested_at_idx
  on public.arca_bulk_accept_runs (requested_at desc);
create index arca_bulk_accept_runs_requested_by_idx
  on public.arca_bulk_accept_runs (requested_by);

alter table public.arca_bulk_accept_runs enable row level security;

-- Aligned with opening_balances:write in lib/auth/permissions.ts (owner only):
-- the run applies opening balances.
create policy "Owner views ARCA bulk accept runs" on public.arca_bulk_accept_runs
  for select to authenticated
  using ( (select public.user_has_role(array['owner'])) );

revoke all on table public.arca_bulk_accept_runs from public, anon, authenticated;
grant select on table public.arca_bulk_accept_runs to authenticated;
grant all on table public.arca_bulk_accept_runs to service_role;
