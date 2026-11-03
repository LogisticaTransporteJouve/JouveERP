SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Importador (roadmap 5.1) + sueldos y viajes históricos (5.2). Expand-only:
-- three new tables, one nullable column on five master tables and two RPCs.
--
-- 1. import_runs: one row per committed import (who, when, kind, file name and
--    SHA-256, row counts, column mapping) and its status, committed or undone.
--    imports:read / imports:write (lib/auth/permissions.ts): owner and admin.
-- 2. import_run_id on clients, suppliers, employees, drivers and vehicles: the
--    run that created the row (NULL for every row loaded by hand). drivers
--    carries it because an imported "Chofer / Acompañante" gets its driver
--    record in the same run, as the employee form does.
-- 3. historic_payroll_entries and historic_trips: past payroll (net and paid
--    per employee and month) and past trips, kept apart from payroll_entries
--    and trips on purpose. Nothing reads them but the importer's screens: no
--    journal entry, treasury movement, employee account, driver extra,
--    Gestión, fleet profitability, libro IVA or AI tool sees them, and the
--    owned-movement and closed-period guards never meet them. Rows are
--    immutable (guard_historic_row); a mistake is fixed by undoing the run.
-- 4. commit_import_run (service role; the action gates on imports:write and
--    the target's write permission): inserts the run and its rows in one
--    transaction, serialized per kind, skipping every row whose natural key
--    already exists (CUIT, CUIL or name, patente, employee + month, the trip's
--    source hash), so re-importing a file adds nothing.
-- 5. undo_import_run: deletes the run's rows when none was edited after the
--    import and no row outside the run references any of them (any foreign
--    key, found in the catalog), then marks the run undone. Idempotent.
--
-- Rollback: older code never selects import_run_id and never reads the new
-- tables; an imported client, supplier, employee or vehicle is an ordinary row
-- for it.

------------------------------------------------------------------------------
-- 1. import_runs
------------------------------------------------------------------------------

create table public.import_runs (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in (
    'clients', 'suppliers', 'employees', 'vehicles', 'historic_payroll', 'historic_trips'
  )),
  status         text not null default 'committed' check (status in ('committed', 'undone')),
  file_name      text not null check (char_length(file_name) between 1 and 255),
  file_sha256    text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  mapping        jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping) = 'object'),
  -- Row counts of one file (a run takes up to 5000 rows).
  -- squawk-ignore prefer-bigint-over-int
  total_rows     integer not null check (total_rows >= 0),
  -- squawk-ignore prefer-bigint-over-int
  inserted_rows  integer not null default 0 check (inserted_rows >= 0),
  -- squawk-ignore prefer-bigint-over-int
  skipped_rows   integer not null default 0 check (skipped_rows >= 0),
  -- squawk-ignore prefer-bigint-over-int
  invalid_rows   integer not null default 0 check (invalid_rows >= 0),
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  undone_by      uuid references auth.users (id) on delete set null,
  undone_at      timestamptz,
  constraint import_runs_undone_stamp check ((status = 'undone') = (undone_at is not null))
);

comment on table public.import_runs is
  'Una importación confirmada (importador de planillas): tipo, archivo y su SHA-256, columnas elegidas, filas importadas, salteadas (ya existían) y con error, quién y cuándo. Deshacerla borra sus filas si nadie las usa.';

create index import_runs_created_at_idx on public.import_runs (created_at desc);
create index import_runs_file_sha256_idx on public.import_runs (file_sha256);
create index import_runs_created_by_idx on public.import_runs (created_by);
create index import_runs_undone_by_idx on public.import_runs (undone_by);

-- A run's identity never changes; its counts are set by the transaction that
-- created it (created_at = now() only there), and it only goes committed →
-- undone, with its stamp. Never deleted: undone runs stay as history.
create function public.guard_import_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Una importación no se borra: deshacela'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.kind is distinct from old.kind
     or new.file_name is distinct from old.file_name
     or new.file_sha256 is distinct from old.file_sha256
     or new.mapping is distinct from old.mapping
     or new.total_rows is distinct from old.total_rows
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Los datos de una importación no se pueden cambiar'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if (new.inserted_rows is distinct from old.inserted_rows
      or new.skipped_rows is distinct from old.skipped_rows
      or new.invalid_rows is distinct from old.invalid_rows)
     and old.created_at <> now() then
    raise exception 'Los totales de una importación no se pueden cambiar'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.status is distinct from old.status
     and not (old.status = 'committed' and new.status = 'undone') then
    raise exception 'Una importación deshecha no vuelve a confirmarse: importá el archivo de nuevo'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.status = old.status
     and (new.undone_at is distinct from old.undone_at
          or new.undone_by is distinct from old.undone_by) then
    raise exception 'Los datos de una importación no se pueden cambiar'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_import_run() from public, anon, authenticated;

create trigger import_runs_guard
  before update or delete on public.import_runs
  for each row execute function public.guard_import_run();

alter table public.import_runs enable row level security;

create policy "Import roles view runs" on public.import_runs
  for select to authenticated
  using ( (select public.user_has_role(array['owner', 'admin'])) );

revoke all on table public.import_runs from public, anon;

------------------------------------------------------------------------------
-- 2. import_run_id on the master tables
------------------------------------------------------------------------------

-- Each column is new and all NULL: the FK check has nothing to scan and the
-- partial index starts empty.
alter table public.clients
  -- squawk-ignore adding-foreign-key-constraint
  add column import_run_id uuid references public.import_runs (id) on delete restrict;
-- squawk-ignore require-concurrent-index-creation
create index clients_import_run_idx on public.clients (import_run_id)
  where import_run_id is not null;

alter table public.suppliers
  -- squawk-ignore adding-foreign-key-constraint
  add column import_run_id uuid references public.import_runs (id) on delete restrict;
-- squawk-ignore require-concurrent-index-creation
create index suppliers_import_run_idx on public.suppliers (import_run_id)
  where import_run_id is not null;

alter table public.employees
  -- squawk-ignore adding-foreign-key-constraint
  add column import_run_id uuid references public.import_runs (id) on delete restrict;
-- squawk-ignore require-concurrent-index-creation
create index employees_import_run_idx on public.employees (import_run_id)
  where import_run_id is not null;

alter table public.drivers
  -- squawk-ignore adding-foreign-key-constraint
  add column import_run_id uuid references public.import_runs (id) on delete restrict;
-- squawk-ignore require-concurrent-index-creation
create index drivers_import_run_idx on public.drivers (import_run_id)
  where import_run_id is not null;

alter table public.vehicles
  -- squawk-ignore adding-foreign-key-constraint
  add column import_run_id uuid references public.import_runs (id) on delete restrict;
-- squawk-ignore require-concurrent-index-creation
create index vehicles_import_run_idx on public.vehicles (import_run_id)
  where import_run_id is not null;

comment on column public.clients.import_run_id is
  'Importación que creó el cliente (import_runs); NULL si se cargó a mano.';
comment on column public.suppliers.import_run_id is
  'Importación que creó el proveedor (import_runs); NULL si se cargó a mano.';
comment on column public.employees.import_run_id is
  'Importación que creó el empleado (import_runs); NULL si se cargó a mano.';
comment on column public.drivers.import_run_id is
  'Importación que creó el chofer junto con su empleado (import_runs); NULL si se cargó a mano.';
comment on column public.vehicles.import_run_id is
  'Importación que creó el vehículo (import_runs); NULL si se cargó a mano.';

------------------------------------------------------------------------------
-- 3. Historic payroll and trips
------------------------------------------------------------------------------

create table public.historic_payroll_entries (
  id            uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references public.import_runs (id) on delete restrict,
  employee_id   uuid not null references public.employees (id) on delete restrict,
  period        text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  kind          text not null default 'monthly' check (kind in ('monthly', 'sac')),
  net_amount    numeric(14, 2) not null check (net_amount >= 0),
  paid_amount   numeric(14, 2) check (paid_amount is null or paid_amount >= 0),
  paid_on       date,
  notes         text check (notes is null or char_length(notes) <= 500),
  created_at    timestamptz not null default now(),
  constraint historic_payroll_entries_sac_month
    check (kind <> 'sac' or substr(period, 6, 2) in ('06', '12')),
  constraint historic_payroll_entries_employee_period_kind_key
    unique (employee_id, period, kind)
);

comment on table public.historic_payroll_entries is
  'Sueldos históricos importados (antes del go-live): neto y pagado por empleado y mes. Solo de referencia: no generan asientos, movimientos de caja ni cuenta corriente del empleado, y no entran en planillas, Gestión ni libros fiscales.';

create index historic_payroll_entries_run_idx on public.historic_payroll_entries (import_run_id);
create index historic_payroll_entries_period_idx on public.historic_payroll_entries (period);

create table public.historic_trips (
  id             uuid primary key default gen_random_uuid(),
  import_run_id  uuid not null references public.import_runs (id) on delete restrict,
  trip_date      date not null,
  vehicle_id     uuid references public.vehicles (id) on delete set null,
  vehicle_label  text check (vehicle_label is null or char_length(vehicle_label) <= 120),
  driver_id      uuid references public.drivers (id) on delete set null,
  driver_label   text check (driver_label is null or char_length(driver_label) <= 120),
  client_id      uuid references public.clients (id) on delete set null,
  client_label   text check (client_label is null or char_length(client_label) <= 120),
  origin         text check (origin is null or char_length(origin) <= 200),
  destination    text check (destination is null or char_length(destination) <= 200),
  km             numeric(10, 1) check (km is null or km >= 0),
  freight_amount numeric(14, 2) check (freight_amount is null or freight_amount >= 0),
  notes          text check (notes is null or char_length(notes) <= 500),
  source_hash    text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  created_at     timestamptz not null default now(),
  constraint historic_trips_source_hash_key unique (source_hash)
);

comment on table public.historic_trips is
  'Viajes históricos importados (antes del go-live): fecha, vehículo, chofer, cliente, origen, destino, km y flete en pesos, con el texto de la planilla cuando no se encontró el registro. Solo de referencia: no generan facturas, extras de chofer ni rentabilidad de flota. source_hash (contenido de la fila y su repetición en el archivo) evita duplicarlos al reimportar.';

create index historic_trips_run_idx on public.historic_trips (import_run_id);
create index historic_trips_trip_date_idx on public.historic_trips (trip_date);
create index historic_trips_vehicle_idx on public.historic_trips (vehicle_id)
  where vehicle_id is not null;
create index historic_trips_driver_idx on public.historic_trips (driver_id)
  where driver_id is not null;
create index historic_trips_client_idx on public.historic_trips (client_id)
  where client_id is not null;

-- Historic rows are what the file said: never edited. The one update allowed
-- is a deleted vehicle, driver or client clearing its id (ON DELETE SET NULL;
-- the label stays). Deleting goes through undo_import_run.
create function public.guard_historic_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if tg_op = 'DELETE' then
    get diagnostics v_stack = pg_context;
    if v_stack ~ 'function (public\.)?undo_import_run\(' then
      return old;
    end if;
    raise exception 'Un dato histórico importado no se borra suelto: deshacé su importación'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if tg_table_name = 'historic_trips'
     and (to_jsonb(new) - array['vehicle_id', 'driver_id', 'client_id'])
         = (to_jsonb(old) - array['vehicle_id', 'driver_id', 'client_id'])
     and (new.vehicle_id is null or new.vehicle_id = old.vehicle_id)
     and (new.driver_id is null or new.driver_id = old.driver_id)
     and (new.client_id is null or new.client_id = old.client_id) then
    return new;
  end if;

  raise exception 'Un dato histórico importado no se edita: deshacé su importación y volvé a importar el archivo corregido'
    using errcode = '55006', hint = 'jouve_guard';
end;
$$;

revoke all on function public.guard_historic_row() from public, anon, authenticated;

create trigger historic_payroll_entries_guard
  before update or delete on public.historic_payroll_entries
  for each row execute function public.guard_historic_row();

create trigger historic_trips_guard
  before update or delete on public.historic_trips
  for each row execute function public.guard_historic_row();

-- Read like the runs (owner/admin); written only by the RPCs below.
alter table public.historic_payroll_entries enable row level security;

create policy "Import roles view historic payroll" on public.historic_payroll_entries
  for select to authenticated
  using ( (select public.user_has_role(array['owner', 'admin'])) );

revoke all on table public.historic_payroll_entries from public, anon;

alter table public.historic_trips enable row level security;

create policy "Import roles view historic trips" on public.historic_trips
  for select to authenticated
  using ( (select public.user_has_role(array['owner', 'admin'])) );

revoke all on table public.historic_trips from public, anon;

------------------------------------------------------------------------------
-- 4. commit_import_run
------------------------------------------------------------------------------

-- p_rows is a JSON array of the rows the action validated (Zod), shaped like
-- the target's columns. A row whose natural key already exists, in the table
-- or earlier in p_rows, is skipped and counted with p_skipped_rows (the
-- duplicates the preview already left out). Names compare trimmed, with runs
-- of spaces collapsed and lowercased (features/imports/lib/keys.ts does the
-- same); patentes compare as their letters and digits.
create function public.commit_import_run(
  p_kind         text,
  p_file_name    text,
  p_file_sha256  text,
  p_mapping      jsonb,
  p_total_rows   integer,
  p_skipped_rows integer,
  p_invalid_rows integer,
  p_rows         jsonb,
  p_user_id      uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id   uuid;
  v_sent     integer;
  v_inserted integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Las filas de la importación no son válidas'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  v_sent := jsonb_array_length(p_rows);
  if v_sent = 0 then
    raise exception 'No hay filas para importar'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if v_sent > 5000 then
    raise exception 'Una importación lleva hasta 5000 filas: dividí el archivo'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  -- Two imports of the same kind never interleave their duplicate checks.
  perform pg_advisory_xact_lock(hashtextextended('import_runs:' || p_kind, 0));

  insert into public.import_runs (
    kind, file_name, file_sha256, mapping, total_rows, invalid_rows, created_by
  )
  values (
    p_kind, p_file_name, p_file_sha256, coalesce(p_mapping, '{}'::jsonb),
    p_total_rows, coalesce(p_invalid_rows, 0), p_user_id
  )
  returning id into v_run_id;

  if p_kind = 'clients' then
    with src as (
      select distinct on (coalesce(r.cuit, lower(regexp_replace(trim(r.legal_name), '\s+', ' ', 'g'))))
             r.*
        from jsonb_to_recordset(p_rows) as r(
               legal_name text, display_name text, cuit text, iva_condition text,
               email text, phone text, address text, real_address text, notes text,
               is_fiscal boolean
             )
       order by coalesce(r.cuit, lower(regexp_replace(trim(r.legal_name), '\s+', ' ', 'g')))
    ),
    ins as (
      insert into public.clients (
        legal_name, display_name, cuit, iva_condition, email, phone, address,
        real_address, notes, is_fiscal, created_by, import_run_id
      )
      select s.legal_name, s.display_name, s.cuit, s.iva_condition, s.email, s.phone,
             s.address, s.real_address, s.notes, s.is_fiscal, p_user_id, v_run_id
        from src s
       where (s.is_fiscal and not exists (
                select 1 from public.clients c where c.cuit = s.cuit))
          or (not s.is_fiscal and not exists (
                select 1 from public.clients c
                 where not c.is_fiscal
                   and lower(regexp_replace(trim(c.legal_name), '\s+', ' ', 'g'))
                     = lower(regexp_replace(trim(s.legal_name), '\s+', ' ', 'g'))))
      on conflict do nothing
      returning 1
    )
    select count(*) into v_inserted from ins;

  elsif p_kind = 'suppliers' then
    with src as (
      select distinct on (coalesce(r.cuit, lower(regexp_replace(trim(r.legal_name), '\s+', ' ', 'g'))))
             r.*
        from jsonb_to_recordset(p_rows) as r(
               legal_name text, display_name text, cuit text, iva_condition text,
               email text, phone text, address text, real_address text, notes text,
               is_fiscal boolean
             )
       order by coalesce(r.cuit, lower(regexp_replace(trim(r.legal_name), '\s+', ' ', 'g')))
    ),
    ins as (
      insert into public.suppliers (
        legal_name, display_name, cuit, iva_condition, email, phone, address,
        real_address, notes, is_fiscal, created_by, import_run_id
      )
      select s.legal_name, s.display_name, s.cuit, s.iva_condition, s.email, s.phone,
             s.address, s.real_address, s.notes, s.is_fiscal, p_user_id, v_run_id
        from src s
       where (s.is_fiscal and not exists (
                select 1 from public.suppliers c where c.cuit = s.cuit))
          or (not s.is_fiscal and not exists (
                select 1 from public.suppliers c
                 where not c.is_fiscal
                   and lower(regexp_replace(trim(c.legal_name), '\s+', ' ', 'g'))
                     = lower(regexp_replace(trim(s.legal_name), '\s+', ' ', 'g'))))
      on conflict do nothing
      returning 1
    )
    select count(*) into v_inserted from ins;

  elsif p_kind = 'employees' then
    with src as (
      select distinct on (coalesce(r.cuil, lower(regexp_replace(trim(r.legal_name), '\s+', ' ', 'g'))))
             r.*
        from jsonb_to_recordset(p_rows) as r(
               legal_name text, position text, cuil text, cbu text, pay_frequency text,
               base_salary numeric, viatico_monthly numeric, is_monotributo boolean,
               hire_date date, termination_date date, notes text, convenio text,
               categoria text, obra_social text, art text
             )
       order by coalesce(r.cuil, lower(regexp_replace(trim(r.legal_name), '\s+', ' ', 'g')))
    ),
    ins as (
      insert into public.employees (
        legal_name, position, cuil, cbu, pay_frequency, base_salary, viatico_monthly,
        is_monotributo, hire_date, termination_date, is_active, notes, convenio,
        categoria, obra_social, art, created_by, import_run_id
      )
      select s.legal_name, s.position, s.cuil, s.cbu, s.pay_frequency, s.base_salary,
             coalesce(s.viatico_monthly, 0), coalesce(s.is_monotributo, false), s.hire_date,
             s.termination_date, s.termination_date is null, s.notes, s.convenio,
             s.categoria, s.obra_social, s.art, p_user_id, v_run_id
        from src s
       where (s.cuil is not null and not exists (
                select 1 from public.employees e where e.cuil = s.cuil))
          or (s.cuil is null and not exists (
                select 1 from public.employees e
                 where lower(regexp_replace(trim(e.legal_name), '\s+', ' ', 'g'))
                     = lower(regexp_replace(trim(s.legal_name), '\s+', ' ', 'g'))))
      returning id, legal_name, cuil, is_active, position
    ),
    drv as (
      -- The employee form gives a driver position its driver record
      -- (features/hr/lib/employee-driver.ts): the same here.
      insert into public.drivers (
        employee_id, full_name, cuit, is_active, created_by, import_run_id
      )
      select i.id, i.legal_name, i.cuil, i.is_active, p_user_id, v_run_id
        from ins i
       where i.position = 'Chofer / Acompañante'
      returning 1
    )
    select count(*) into v_inserted from ins;

  elsif p_kind = 'vehicles' then
    with src as (
      select distinct on (upper(regexp_replace(r.patente, '[^0-9A-Za-z]', '', 'g')))
             r.*
        from jsonb_to_recordset(p_rows) as r(
               patente text, vehicle_type text, alias text, brand text, model text,
               year integer, fleet text, fuel_card text, capacity_kg numeric, notes text
             )
       order by upper(regexp_replace(r.patente, '[^0-9A-Za-z]', '', 'g'))
    ),
    ins as (
      insert into public.vehicles (
        patente, vehicle_type, alias, brand, model, year, fleet, fuel_card,
        capacity_kg, notes, created_by, import_run_id
      )
      select s.patente, s.vehicle_type, s.alias, s.brand, s.model, s.year, s.fleet,
             s.fuel_card, s.capacity_kg, s.notes, p_user_id, v_run_id
        from src s
       where not exists (
               select 1 from public.vehicles v
                where upper(regexp_replace(v.patente, '[^0-9A-Za-z]', '', 'g'))
                    = upper(regexp_replace(s.patente, '[^0-9A-Za-z]', '', 'g')))
      on conflict do nothing
      returning 1
    )
    select count(*) into v_inserted from ins;

  elsif p_kind = 'historic_payroll' then
    with ins as (
      insert into public.historic_payroll_entries (
        import_run_id, employee_id, period, kind, net_amount, paid_amount, paid_on, notes
      )
      select v_run_id, r.employee_id, r.period, r.kind, r.net_amount, r.paid_amount,
             r.paid_on, r.notes
        from jsonb_to_recordset(p_rows) as r(
               employee_id uuid, period text, kind text, net_amount numeric,
               paid_amount numeric, paid_on date, notes text
             )
      on conflict (employee_id, period, kind) do nothing
      returning 1
    )
    select count(*) into v_inserted from ins;

  elsif p_kind = 'historic_trips' then
    with ins as (
      insert into public.historic_trips (
        import_run_id, trip_date, vehicle_id, vehicle_label, driver_id, driver_label,
        client_id, client_label, origin, destination, km, freight_amount, notes,
        source_hash
      )
      select v_run_id, r.trip_date, r.vehicle_id, r.vehicle_label, r.driver_id,
             r.driver_label, r.client_id, r.client_label, r.origin, r.destination,
             r.km, r.freight_amount, r.notes, r.source_hash
        from jsonb_to_recordset(p_rows) as r(
               trip_date date, vehicle_id uuid, vehicle_label text, driver_id uuid,
               driver_label text, client_id uuid, client_label text, origin text,
               destination text, km numeric, freight_amount numeric, notes text,
               source_hash text
             )
      on conflict (source_hash) do nothing
      returning 1
    )
    select count(*) into v_inserted from ins;

  else
    raise exception 'Tipo de importación desconocido: %', p_kind
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  update public.import_runs
     set inserted_rows = v_inserted,
         skipped_rows = coalesce(p_skipped_rows, 0) + (v_sent - v_inserted)
   where id = v_run_id;

  return v_run_id;
end;
$$;

comment on function public.commit_import_run(text, text, text, jsonb, integer, integer, integer, jsonb, uuid) is
  'Registra una importación y sus filas en una transacción, salteando las que ya existen por su clave natural. Solo service role (la acción exige imports:write).';

revoke all on function public.commit_import_run(text, text, text, jsonb, integer, integer, integer, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.commit_import_run(text, text, text, jsonb, integer, integer, integer, jsonb, uuid)
  to service_role;

------------------------------------------------------------------------------
-- 5. undo_import_run
------------------------------------------------------------------------------

create function public.undo_import_run(p_run_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run      public.import_runs%rowtype;
  v_tables   text[];
  v_table    text;
  v_fk       record;
  v_found    boolean;
  v_edited   boolean;
begin
  select * into v_run from public.import_runs where id = p_run_id for update;
  if not found then
    raise exception 'La importación no existe'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  -- A retry of an undo that already went through.
  if v_run.status = 'undone' then
    return;
  end if;

  -- Children before parents: an imported driver points at its employee.
  v_tables := case v_run.kind
    when 'clients' then array['clients']
    when 'suppliers' then array['suppliers']
    when 'employees' then array['drivers', 'employees']
    when 'vehicles' then array['vehicles']
    when 'historic_payroll' then array['historic_payroll_entries']
    when 'historic_trips' then array['historic_trips']
  end;

  foreach v_table in array v_tables loop
    -- Locking the rows first keeps anyone from pointing a new row at them
    -- (a foreign key insert takes KEY SHARE) until this transaction ends.
    execute format('select 1 from public.%I where import_run_id = $1 for update', v_table)
      using p_run_id;

    if v_table not in ('historic_payroll_entries', 'historic_trips') then
      execute format(
        'select exists (select 1 from public.%I where import_run_id = $1 and updated_at > created_at)',
        v_table)
        into v_edited using p_run_id;
      if v_edited then
        raise exception 'No se puede deshacer la importación: algún registro se editó después de importarlo'
          using errcode = '55006', hint = 'jouve_guard';
      end if;
    end if;

    -- Every single-column foreign key that points at this table, from any
    -- table: a referencing row outside this run blocks the undo.
    for v_fk in
      select src.relname as src_table, sa.attname as src_column, ta.attname as ref_column,
             exists (
               select 1 from pg_catalog.pg_attribute ia
                where ia.attrelid = c.conrelid and ia.attname = 'import_run_id'
                  and not ia.attisdropped
             ) as src_has_run
        from pg_catalog.pg_constraint c
        join pg_catalog.pg_class src on src.oid = c.conrelid
        join pg_catalog.pg_namespace sn on sn.oid = src.relnamespace
        join pg_catalog.pg_attribute sa on sa.attrelid = c.conrelid and sa.attnum = c.conkey[1]
        join pg_catalog.pg_attribute ta on ta.attrelid = c.confrelid and ta.attnum = c.confkey[1]
       where c.contype = 'f'
         and c.confrelid = format('public.%I', v_table)::regclass
         and cardinality(c.conkey) = 1
    loop
      execute format(
        'select exists (select 1 from public.%I r where r.%I in (select t.%I from public.%I t where t.import_run_id = $1)%s)',
        v_fk.src_table, v_fk.src_column, v_fk.ref_column, v_table,
        case when v_fk.src_has_run then ' and r.import_run_id is distinct from $1' else '' end)
        into v_found using p_run_id;
      if v_found then
        raise exception 'No se puede deshacer la importación: sus registros ya se usan en otros datos (%)', v_fk.src_table
          using errcode = '55006', hint = 'jouve_guard';
      end if;
    end loop;

    execute format('delete from public.%I where import_run_id = $1', v_table)
      using p_run_id;
  end loop;

  update public.import_runs
     set status = 'undone', undone_at = now(), undone_by = p_user_id
   where id = p_run_id;
end;
$$;

comment on function public.undo_import_run(uuid, uuid) is
  'Deshace una importación: borra sus filas si ninguna se editó ni se usa en otros datos y la marca deshecha. Idempotente. Solo service role (la acción exige imports:write).';

revoke all on function public.undo_import_run(uuid, uuid) from public, anon, authenticated;
grant execute on function public.undo_import_run(uuid, uuid) to service_role;
