SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A trip's Acompañante: an employee who rides with the driver; optional.
-- trips' existing RLS covers the column. Rollback: older code neither reads
-- nor writes it.

alter table public.trips
  -- squawk-ignore adding-foreign-key-constraint
  add column companion_employee_id uuid references public.employees (id) on delete set null;

-- Serves the FK's on delete set null; trips is a small table.
-- squawk-ignore require-concurrent-index-creation
create index trips_companion_idx on public.trips (companion_employee_id)
  where companion_employee_id is not null;

comment on column public.trips.companion_employee_id is
  'Acompañante del chofer: un empleado; opcional.';
