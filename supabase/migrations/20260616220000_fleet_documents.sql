-- Fase G.6 — Documentación vencible de flota (fleet_documents): VTV, seguro,
-- cédula, RTO/ruta de un VEHÍCULO, o licencia, LNH, ART, libreta de un CHOFER.
-- Un cron diario alerta los vencimientos ≤ 30 días (reusa el tipo de notif
-- `document_expiring`). docs/roadmap.md Fase G.6 + docs/files-patterns.md.
--
-- Una fila apunta a EXACTAMENTE un dueño (vehículo XOR chofer) — FKs reales
-- nullables + check. RLS: gestión por owner/admin/operations.

set row_security = off;

create table public.fleet_documents (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid references public.vehicles (id) on delete cascade,
  driver_id   uuid references public.drivers (id) on delete cascade,
  kind        text not null
                check (kind in (
                  'vtv', 'seguro', 'cedula', 'ruta', 'senasa',
                  'licencia', 'lnh', 'art', 'libreta', 'curso', 'otro'
                )),
  number      text,
  issued_at   date,
  expires_at  date not null,
  notified_at timestamptz,
  notes       text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Exactamente un dueño: vehículo XOR chofer.
  constraint fleet_documents_one_owner
    check ((vehicle_id is not null) <> (driver_id is not null)),
  constraint fleet_documents_issued_before_expires
    check (issued_at is null or expires_at >= issued_at)
);

comment on table public.fleet_documents is
  'Documentación vencible de flota: VTV/seguro/cédula/ruta de un vehículo, o licencia/LNH/ART/libreta de un chofer. Cron diario alerta ≤30 días.';

create index fleet_documents_expires_idx on public.fleet_documents (expires_at);
create index fleet_documents_vehicle_idx on public.fleet_documents (vehicle_id);
create index fleet_documents_driver_idx on public.fleet_documents (driver_id);

create trigger fleet_documents_set_updated_at
  before update on public.fleet_documents
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- RLS — gestión por owner/admin/operations
------------------------------------------------------------------------------
alter table public.fleet_documents enable row level security;

create policy "fleet_documents select"
  on public.fleet_documents for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']));
create policy "fleet_documents insert"
  on public.fleet_documents for insert to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'operations']));
create policy "fleet_documents update"
  on public.fleet_documents for update to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']))
  with check (public.user_has_role(array['owner', 'admin', 'operations']));
create policy "fleet_documents delete"
  on public.fleet_documents for delete to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']));
