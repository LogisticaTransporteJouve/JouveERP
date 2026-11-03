SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Extras desde viajes (roadmap 3.5): what a driver earns per trip day, per km
-- and per unloading. The planilla suggests the month's extras from the
-- completed trips of the employee's driver (jornadas = distinct trip days,
-- km = the trips' km, descargas = their delivered shipments) times these
-- rates; the suggestion is added as ordinary editable extras. All NULL
-- (every existing employee) = no suggestion for that concept.

alter table public.employees
  add column trip_rate_per_day numeric(15, 2),
  add column trip_rate_per_km numeric(15, 2),
  add column trip_rate_per_unload numeric(15, 2);

alter table public.employees
  -- squawk-ignore constraint-missing-not-valid
  add constraint employees_trip_rates_nonnegative check (
    coalesce(trip_rate_per_day, 0) >= 0
    and coalesce(trip_rate_per_km, 0) >= 0
    and coalesce(trip_rate_per_unload, 0) >= 0
  );

comment on column public.employees.trip_rate_per_day is 'Extra por jornada de viaje (día con al menos un viaje completado).';
comment on column public.employees.trip_rate_per_km is 'Extra por km de los viajes completados.';
comment on column public.employees.trip_rate_per_unload is 'Extra por descarga (carga entregada de un viaje completado).';
