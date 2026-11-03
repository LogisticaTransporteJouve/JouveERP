SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Guía del sidebar (roadmap 6.5). Expand-only: one table.
--
-- user_guide_states: one row per user with the guide panel's state, so it
-- follows the user across devices: whether the panel is collapsed and the
-- go-live checklist items they marked as done by hand (the ones the app
-- cannot derive from data). Absence of a row = expanded, nothing dismissed.
-- Item keys are validated by the server action (features/guide); the DB
-- only bounds the list. Each user reads and writes only their own row.

create table public.user_guide_states (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  collapsed       boolean not null default false,
  dismissed_items text[] not null default '{}'
                    check (cardinality(dismissed_items) <= 50),
  updated_at      timestamptz not null default now()
);

comment on table public.user_guide_states is
  'Estado de la guía del sidebar por usuario: panel colapsado y los ítems del checklist de arranque que marcó como hechos a mano.';

create trigger user_guide_states_set_updated_at
  before update on public.user_guide_states
  for each row execute function public.set_updated_at();

alter table public.user_guide_states enable row level security;

create policy "Users view their guide state" on public.user_guide_states
  for select to authenticated
  using ( user_id = (select auth.uid()) );

create policy "Users create their guide state" on public.user_guide_states
  for insert to authenticated
  with check ( user_id = (select auth.uid()) );

create policy "Users edit their guide state" on public.user_guide_states
  for update to authenticated
  using ( user_id = (select auth.uid()) )
  with check ( user_id = (select auth.uid()) );

revoke all on table public.user_guide_states from public, anon;
