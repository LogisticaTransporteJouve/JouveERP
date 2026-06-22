-- Fase G.4 + G.5 — Costos de flota: combustible (fuel_loads) + mantenimientos
-- (maintenance_records). Ambos cuelgan de un vehículo y alimentan la
-- rentabilidad por vehículo/viaje (G.7). docs/roadmap.md Fase G.
--
-- RLS: gestión por owner/admin/operations (perms fuel:* / maintenance:*).

set row_security = off;

------------------------------------------------------------------------------
-- 1. fuel_loads (cargas de combustible)
------------------------------------------------------------------------------
create table public.fuel_loads (
  id              uuid primary key default gen_random_uuid(),
  vehicle_id      uuid not null references public.vehicles (id) on delete cascade,
  trip_id         uuid references public.trips (id) on delete set null,
  load_date       date not null,
  liters          numeric(10, 2) not null check (liters > 0),
  amount          numeric(14, 2) not null check (amount >= 0),
  odometer_km     numeric(10, 1) check (odometer_km is null or odometer_km >= 0),
  station         text,
  card            text,
  notes           text,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.fuel_loads is
  'Cargas de combustible por vehículo (litros + importe + odómetro). Opcionalmente atadas a un viaje. Insumo del costo por vehículo (G.7).';

create index fuel_loads_vehicle_idx on public.fuel_loads (vehicle_id, load_date desc);
create index fuel_loads_trip_idx on public.fuel_loads (trip_id);

create trigger fuel_loads_set_updated_at
  before update on public.fuel_loads
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 2. maintenance_records (mantenimientos / reparaciones)
------------------------------------------------------------------------------
create table public.maintenance_records (
  id                uuid primary key default gen_random_uuid(),
  vehicle_id        uuid not null references public.vehicles (id) on delete cascade,
  service_date      date not null,
  kind              text not null
                      check (kind in ('service', 'reparacion', 'neumaticos', 'vtv', 'otro')),
  description       text not null,
  cost              numeric(14, 2) check (cost is null or cost >= 0),
  odometer_km       numeric(10, 1) check (odometer_km is null or odometer_km >= 0),
  next_service_date date,
  next_service_km   numeric(10, 1) check (next_service_km is null or next_service_km >= 0),
  provider          text,
  notes             text,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.maintenance_records is
  'Mantenimientos y reparaciones por vehículo (con costo + próximo service por fecha/km). Insumo del costo por vehículo (G.7).';

create index maintenance_vehicle_idx on public.maintenance_records (vehicle_id, service_date desc);
create index maintenance_next_idx on public.maintenance_records (next_service_date);

create trigger maintenance_records_set_updated_at
  before update on public.maintenance_records
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 3. RLS — gestión por owner/admin/operations
------------------------------------------------------------------------------
alter table public.fuel_loads enable row level security;
alter table public.maintenance_records enable row level security;

create policy "fuel_loads select"
  on public.fuel_loads for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']));
create policy "fuel_loads insert"
  on public.fuel_loads for insert to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'operations']));
create policy "fuel_loads update"
  on public.fuel_loads for update to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']))
  with check (public.user_has_role(array['owner', 'admin', 'operations']));
create policy "fuel_loads delete"
  on public.fuel_loads for delete to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']));

create policy "maintenance select"
  on public.maintenance_records for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']));
create policy "maintenance insert"
  on public.maintenance_records for insert to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'operations']));
create policy "maintenance update"
  on public.maintenance_records for update to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']))
  with check (public.user_has_role(array['owner', 'admin', 'operations']));
create policy "maintenance delete"
  on public.maintenance_records for delete to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']));
