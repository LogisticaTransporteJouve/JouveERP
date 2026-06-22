-- Fase G.3 — Acceso del chofer a sus propios viajes (driver :own).
--
-- Se vincula un chofer (drivers) a un usuario de la app (auth.users) vía
-- `user_id` (único: un login = un chofer). Con eso, RLS deja que el rol driver
-- vea SOLO sus viajes (trips.driver_id → su drivers.user_id), su propia ficha
-- de chofer, y el catálogo de vehículos (para los nombres embebidos en la
-- lista de viajes). El rol driver ya tiene el permiso trips:read.
-- docs/roadmap.md Fase G.3 (decisión #4).

set row_security = off;

alter table public.drivers
  add column user_id uuid references auth.users (id) on delete set null;

-- Un usuario de la app mapea a lo sumo a un chofer (NULLs no colisionan en PG).
alter table public.drivers
  add constraint drivers_user_id_unique unique (user_id);

create index drivers_user_idx on public.drivers (user_id);

------------------------------------------------------------------------------
-- RLS adicional (las policies se combinan con OR; las de owner/admin/etc.
-- siguen intactas).
------------------------------------------------------------------------------

-- El chofer ve su propia ficha.
create policy "drivers select own"
  on public.drivers for select
  to authenticated
  using (user_id = (select auth.uid()));

-- El chofer ve SOLO los viajes asignados a él.
create policy "trips select own driver"
  on public.trips for select
  to authenticated
  using (
    exists (
      select 1
      from public.drivers d
      where d.id = trips.driver_id
        and d.user_id = (select auth.uid())
    )
  );

-- El chofer puede leer el catálogo de vehículos (para la patente embebida en
-- la lista de sus viajes y contexto). Solo lectura; el rol driver no tiene
-- vehicles:write.
create policy "vehicles select for drivers"
  on public.vehicles for select
  to authenticated
  using (public.user_has_role(array['driver']));

set row_security = on;
