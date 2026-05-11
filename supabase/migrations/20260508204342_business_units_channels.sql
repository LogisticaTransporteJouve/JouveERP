-- B.4 — business units and invoicing channels.
--
-- DZ & Sons S.A. operates two commercial divisions (DZ Instalaciones,
-- Logística Jouve) under one CUIT. Each division has a fiscal AFIP channel
-- and a non-fiscal internal channel, totalling 4 channels today. The schema
-- allows additional channels (extra puntos de venta, future divisions)
-- without a new migration — only inserts.

set row_security = off;

------------------------------------------------------------------------------
-- 1. business_units
------------------------------------------------------------------------------
create table public.business_units (
  id             text primary key,
  name           text not null,
  cuit           text not null,
  tax_condition  text not null,
  tax_address    text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.business_units is 'Legal entities under which channels emit invoices. JouveERP runs single-CUIT.';

-- Enforce CUIT shape (11 digits, no separators) so AFIP padron lookups work.
alter table public.business_units
  add constraint business_units_cuit_format check (cuit ~ '^[0-9]{11}$');

insert into public.business_units (id, name, cuit, tax_condition, tax_address) values
  ('dz_sons', 'DZ & Sons S.A.', '30714637432', 'IVA Responsable Inscripto', null);

alter table public.business_units enable row level security;

create policy "Authenticated users can view business units"
  on public.business_units for select
  to authenticated
  using (true);

create policy "Owners and admins can write business units"
  on public.business_units for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'admin']));

create policy "Owners and admins can update business units"
  on public.business_units for update
  to authenticated
  using (public.user_has_role(array['owner', 'admin']))
  with check (public.user_has_role(array['owner', 'admin']));

create policy "Owners and admins can delete business units"
  on public.business_units for delete
  to authenticated
  using (public.user_has_role(array['owner', 'admin']));

------------------------------------------------------------------------------
-- 2. invoicing_channels
------------------------------------------------------------------------------
create table public.invoicing_channels (
  id                text primary key,
  business_unit_id  text not null references public.business_units (id) on delete restrict,
  name              text not null,
  division          text not null check (division in ('dz', 'jouve')),
  is_fiscal         boolean not null,
  display_color     text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.invoicing_channels is 'Per-division emission channels. Each transaction in Phase D is tagged with a channel_id.';

create index invoicing_channels_business_unit_idx
  on public.invoicing_channels (business_unit_id);
create index invoicing_channels_division_idx
  on public.invoicing_channels (division);

-- The schema allows multiple channels per (unit, division, is_fiscal)
-- combination — for example several sales points sharing the same fiscal
-- division. So no compound unique constraint here. The seed below covers the
-- canonical four channels; new ones land via INSERT.

insert into public.invoicing_channels
  (id, business_unit_id, name, division, is_fiscal) values
  ('dz_fiscal',       'dz_sons', 'DZ Instalaciones — Fiscal',   'dz',    true),
  ('dz_internal',     'dz_sons', 'DZ Instalaciones — Interno',  'dz',    false),
  ('jouve_fiscal',    'dz_sons', 'Logística Jouve — Fiscal',    'jouve', true),
  ('jouve_internal',  'dz_sons', 'Logística Jouve — Interno',   'jouve', false);

alter table public.invoicing_channels enable row level security;

create policy "Authenticated users can view invoicing channels"
  on public.invoicing_channels for select
  to authenticated
  using (true);

create policy "Owners and admins can write invoicing channels"
  on public.invoicing_channels for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'admin']));

create policy "Owners and admins can update invoicing channels"
  on public.invoicing_channels for update
  to authenticated
  using (public.user_has_role(array['owner', 'admin']))
  with check (public.user_has_role(array['owner', 'admin']));

create policy "Owners and admins can delete invoicing channels"
  on public.invoicing_channels for delete
  to authenticated
  using (public.user_has_role(array['owner', 'admin']));

------------------------------------------------------------------------------
-- 3. updated_at trigger (reused by future tables)
------------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger business_units_set_updated_at
  before update on public.business_units
  for each row execute function public.set_updated_at();

create trigger invoicing_channels_set_updated_at
  before update on public.invoicing_channels
  for each row execute function public.set_updated_at();

set row_security = on;
