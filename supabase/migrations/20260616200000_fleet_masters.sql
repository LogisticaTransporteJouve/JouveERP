-- Fase G.1 + G.2 — Core de flota: choferes (drivers) + vehículos (vehicles) +
-- viajes (trips, con cargas y costos).
--
-- Choferes pueden ser empleados propios (pago semanal, `employee_id` seteado) o
-- contratados/monotributistas (`employee_id` null, datos propios en la fila).
-- Vehículos = patente única + datos del rodado. Viajes referencian chofer +
-- vehículo (FK set null para preservar el histórico) con origen/destino, carga,
-- estado y financiero (revenue/cost → rentabilidad en G.7). Vencimientos de
-- documentación (VTV/seguro/licencia) llegan en G.5/G.6. docs/roadmap.md Fase G.
--
-- RLS: gestión por owner/admin/operations (perms drivers:* / vehicles:* / trips:*).

set row_security = off;

------------------------------------------------------------------------------
-- 1. drivers
------------------------------------------------------------------------------
create table public.drivers (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid references public.employees (id) on delete set null,
  full_name        text not null,
  cuit             text,
  license_number   text,
  license_category text,
  phone            text,
  is_active        boolean not null default true,
  notes            text,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.drivers is
  'Choferes: empleados propios (employee_id seteado) o contratados (employee_id null, datos propios). Su documentación vencible llega en G.6.';

create index drivers_active_idx on public.drivers (is_active, full_name);
create index drivers_employee_idx on public.drivers (employee_id);

create trigger drivers_set_updated_at
  before update on public.drivers
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 2. vehicles
------------------------------------------------------------------------------
create table public.vehicles (
  id           uuid primary key default gen_random_uuid(),
  patente      text not null,
  alias        text,
  vehicle_type text not null
                 check (vehicle_type in ('camion', 'acoplado', 'semi', 'utilitario', 'furgon', 'auto', 'otro')),
  brand        text,
  model        text,
  year         integer check (year is null or (year >= 1950 and year <= 2100)),
  fleet        text,
  capacity_kg  numeric(10, 2) check (capacity_kg is null or capacity_kg >= 0),
  is_active    boolean not null default true,
  notes        text,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint vehicles_patente_unique unique (patente)
);

comment on table public.vehicles is
  'Vehículos de la flota (patente única). Vencimientos de VTV/seguro/documentación llegan en G.5/G.6.';

create index vehicles_active_idx on public.vehicles (is_active, patente);

create trigger vehicles_set_updated_at
  before update on public.vehicles
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 3. trips (viajes)
------------------------------------------------------------------------------
create table public.trips (
  id                uuid primary key default gen_random_uuid(),
  trip_date         date not null,
  driver_id         uuid references public.drivers (id) on delete set null,
  vehicle_id        uuid references public.vehicles (id) on delete set null,
  channel_id        text references public.invoicing_channels (id) on delete set null,
  origin            text,
  destination       text,
  cargo_description  text,
  status            text not null default 'planned'
                      check (status in ('planned', 'in_progress', 'completed', 'cancelled')),
  km                numeric(10, 2) check (km is null or km >= 0),
  revenue           numeric(14, 2) check (revenue is null or revenue >= 0),
  cost              numeric(14, 2) check (cost is null or cost >= 0),
  notes             text,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.trips is
  'Viajes de flota: chofer + vehículo + origen/destino + carga + estado + financiero (revenue/cost). Rentabilidad agregada en G.7.';

create index trips_date_idx on public.trips (trip_date desc);
create index trips_driver_idx on public.trips (driver_id);
create index trips_vehicle_idx on public.trips (vehicle_id);
create index trips_status_idx on public.trips (status, trip_date desc);

create trigger trips_set_updated_at
  before update on public.trips
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 4. RLS — gestión por owner/admin/operations
------------------------------------------------------------------------------
alter table public.drivers enable row level security;
alter table public.vehicles enable row level security;
alter table public.trips enable row level security;

create policy "drivers select"
  on public.drivers for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']));
create policy "drivers insert"
  on public.drivers for insert to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'operations']));
create policy "drivers update"
  on public.drivers for update to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']))
  with check (public.user_has_role(array['owner', 'admin', 'operations']));
create policy "drivers delete"
  on public.drivers for delete to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']));

create policy "vehicles select"
  on public.vehicles for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']));
create policy "vehicles insert"
  on public.vehicles for insert to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'operations']));
create policy "vehicles update"
  on public.vehicles for update to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']))
  with check (public.user_has_role(array['owner', 'admin', 'operations']));
create policy "vehicles delete"
  on public.vehicles for delete to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']));

create policy "trips select"
  on public.trips for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']));
create policy "trips insert"
  on public.trips for insert to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'operations']));
create policy "trips update"
  on public.trips for update to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']))
  with check (public.user_has_role(array['owner', 'admin', 'operations']));
create policy "trips delete"
  on public.trips for delete to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']));
