-- Per-user dashboard layout: which widgets show on /dashboard, in what
-- order and size. One row per user; absence of a row means "use the
-- role-based default template" (resolved in app code). The layout jsonb
-- is an ordered array of { id, size } validated by zod in the server
-- action — the DB only guards shape basics.

create table public.dashboard_layouts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  layout jsonb not null,
  updated_at timestamptz not null default now(),
  constraint dashboard_layouts_layout_is_array
    check (jsonb_typeof(layout) = 'array')
);

alter table public.dashboard_layouts enable row level security;

create policy "dashboard_layouts_select_self"
  on public.dashboard_layouts for select to authenticated
  using (user_id = (select auth.uid()));

create policy "dashboard_layouts_insert_self"
  on public.dashboard_layouts for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "dashboard_layouts_update_self"
  on public.dashboard_layouts for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "dashboard_layouts_delete_self"
  on public.dashboard_layouts for delete to authenticated
  using (user_id = (select auth.uid()));
