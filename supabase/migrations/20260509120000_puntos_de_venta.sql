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
-- 1. puntos_de_venta
------------------------------------------------------------------------------
create table public.puntos_de_venta (
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

comment on table public.puntos_de_venta is
  'Business-side enrichment of AFIP sales points discovered via FEParamGetPtosVenta.';

create index puntos_de_venta_channel_idx on public.puntos_de_venta (channel_id);
create index puntos_de_venta_enabled_idx on public.puntos_de_venta (is_enabled)
  where is_enabled = true;

create trigger puntos_de_venta_set_updated_at
  before update on public.puntos_de_venta
  for each row execute function public.set_updated_at();

alter table public.puntos_de_venta enable row level security;

create policy "Authenticated users can view puntos de venta"
  on public.puntos_de_venta for select
  to authenticated
  using (true);

create policy "Owners and admins can insert puntos de venta"
  on public.puntos_de_venta for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'admin']));

create policy "Owners and admins can update puntos de venta"
  on public.puntos_de_venta for update
  to authenticated
  using (public.user_has_role(array['owner', 'admin']))
  with check (public.user_has_role(array['owner', 'admin']));

create policy "Owners and admins can delete puntos de venta"
  on public.puntos_de_venta for delete
  to authenticated
  using (public.user_has_role(array['owner', 'admin']));

set row_security = on;
