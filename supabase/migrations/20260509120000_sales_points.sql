-- E.1.5 — puntos de venta (AFIP).
--
-- AFIP returns a flat list of POS via FEParamGetPtosVenta with no description
-- field. This table holds the business-side enrichment: which channel a POS
-- belongs to, a human nickname, and whether JouveERP should offer it for
-- emission. Only authenticated `owner|admin` can write — POS configuration
-- is a setup activity.
--
-- The table is keyed by `numero` (single-CUIT app, see roadmap §0). If we
-- ever go multi-CUIT this would gain a `cuit` column and a composite PK.

set row_security = off;

------------------------------------------------------------------------------
-- 1. sales_points
------------------------------------------------------------------------------
create table public.sales_points (
  numero                     int primary key check (numero between 1 and 99999),
  channel_id                 text references public.invoicing_channels (id) on delete restrict,
  nickname                   text,
  is_enabled                 boolean not null default false,
  last_known_emission_type   text,
  last_known_blocked         boolean not null default false,
  last_synced_at             timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

comment on table public.sales_points is
  'Business-side enrichment of AFIP sales points discovered via FEParamGetPtosVenta.';

create index sales_points_channel_idx on public.sales_points (channel_id);
create index sales_points_enabled_idx on public.sales_points (is_enabled)
  where is_enabled = true;

create trigger sales_points_set_updated_at
  before update on public.sales_points
  for each row execute function public.set_updated_at();

alter table public.sales_points enable row level security;

create policy "Authenticated users can view puntos de venta"
  on public.sales_points for select
  to authenticated
  using (true);

create policy "Owners and admins can insert puntos de venta"
  on public.sales_points for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'admin']));

create policy "Owners and admins can update puntos de venta"
  on public.sales_points for update
  to authenticated
  using (public.user_has_role(array['owner', 'admin']))
  with check (public.user_has_role(array['owner', 'admin']));

create policy "Owners and admins can delete puntos de venta"
  on public.sales_points for delete
  to authenticated
  using (public.user_has_role(array['owner', 'admin']));

set row_security = on;
