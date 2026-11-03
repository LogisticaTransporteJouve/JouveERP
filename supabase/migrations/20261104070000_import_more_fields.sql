SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Importador: more data from the spreadsheet. Expand-only: one nullable
-- column and commit_import_run with three kinds taking more columns.
--
-- 1. Suppliers carry their purchase defaults: category_id,
--    default_expense_account_id and default_cost_center_id (the action
--    resolves them by name or code; suppliers_guard_expense_account still
--    refuses an account that is not a postable expense leaf).
-- 2. An imported "Chofer / Acompañante" gets its license number and
--    category on its driver record and, with an expiry date, a 'licencia'
--    fleet document (Flota › Vencimientos, whose daily job warns before it
--    expires). fleet_documents.import_run_id marks the document as the run's,
--    so undoing the run (import_run_outside_reference skips the run's own
--    rows) deletes it with its driver (on delete cascade); a document loaded
--    by hand for an imported driver still blocks the undo.
-- 3. Client tariffs take an optional area (storage_areas, resolved by name
--    within its warehouse by the action). The natural key is client, concept,
--    area and start; an area tariff and the general one are separate lines,
--    as guard_client_tariff_overlap has them.
--
-- Rollback: older code sends rows without the new keys, which read as NULL
-- here (the same rows as before); it never selects
-- fleet_documents.import_run_id.

------------------------------------------------------------------------------
-- 1. fleet_documents.import_run_id
------------------------------------------------------------------------------

-- New and all NULL: the FK check has nothing to scan, the index starts empty.
alter table public.fleet_documents
  -- squawk-ignore adding-foreign-key-constraint
  add column import_run_id uuid references public.import_runs (id) on delete restrict;
-- squawk-ignore require-concurrent-index-creation
create index fleet_documents_import_run_idx on public.fleet_documents (import_run_id)
  where import_run_id is not null;

comment on column public.fleet_documents.import_run_id is
  'Importación que creó el documento junto con su chofer (la licencia de un empleado importado); NULL si se cargó a mano.';

------------------------------------------------------------------------------
-- 2. commit_import_run
------------------------------------------------------------------------------

-- Same as 20261103140100 plus: supplier defaults, the driver's license and
-- its fleet document, and the tariff's area.
create or replace function public.commit_import_run(
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
  v_row      record;
  v_loan_id  uuid;
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
        from jsonb_array_elements(p_rows) with ordinality as e(value, ord)
       cross join lateral jsonb_to_record(e.value) as r(
               legal_name text, display_name text, cuit text, iva_condition text,
               email text, phone text, address text, real_address text, notes text,
               is_fiscal boolean
             )
       order by coalesce(r.cuit, lower(regexp_replace(trim(r.legal_name), '\s+', ' ', 'g'))), e.ord
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
        from jsonb_array_elements(p_rows) with ordinality as e(value, ord)
       cross join lateral jsonb_to_record(e.value) as r(
               legal_name text, display_name text, cuit text, iva_condition text,
               email text, phone text, address text, real_address text, notes text,
               is_fiscal boolean, category_id uuid, default_expense_account_id uuid,
               default_cost_center_id uuid
             )
       order by coalesce(r.cuit, lower(regexp_replace(trim(r.legal_name), '\s+', ' ', 'g'))), e.ord
    ),
    ins as (
      insert into public.suppliers (
        legal_name, display_name, cuit, iva_condition, email, phone, address,
        real_address, notes, is_fiscal, category_id, default_expense_account_id,
        default_cost_center_id, created_by, import_run_id
      )
      select s.legal_name, s.display_name, s.cuit, s.iva_condition, s.email, s.phone,
             s.address, s.real_address, s.notes, s.is_fiscal, s.category_id,
             s.default_expense_account_id, s.default_cost_center_id, p_user_id, v_run_id
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
        from jsonb_array_elements(p_rows) with ordinality as e(value, ord)
       cross join lateral jsonb_to_record(e.value) as r(
               legal_name text, position text, cuil text, cbu text, pay_frequency text,
               base_salary numeric, viatico_monthly numeric, is_monotributo boolean,
               hire_date date, termination_date date, notes text, convenio text,
               categoria text, obra_social text, art text, license_number text,
               license_category text, license_expires_at date
             )
       order by coalesce(r.cuil, lower(regexp_replace(trim(r.legal_name), '\s+', ' ', 'g'))), e.ord
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
      -- (features/hr/lib/employee-driver.ts), with its license: the same
      -- here. src has one row per (legal_name, cuil), so the join finds the
      -- row each employee came from.
      insert into public.drivers (
        employee_id, full_name, cuit, is_active, license_number, license_category,
        created_by, import_run_id
      )
      select i.id, i.legal_name, i.cuil, i.is_active, s.license_number,
             s.license_category, p_user_id, v_run_id
        from ins i
        join src s on s.legal_name = i.legal_name and s.cuil is not distinct from i.cuil
       where i.position = 'Chofer / Acompañante'
      returning id, employee_id
    ),
    lic as (
      insert into public.fleet_documents (
        driver_id, kind, number, expires_at, created_by, import_run_id
      )
      select d.id, 'licencia', s.license_number, s.license_expires_at, p_user_id, v_run_id
        from drv d
        join ins i on i.id = d.employee_id
        join src s on s.legal_name = i.legal_name and s.cuil is not distinct from i.cuil
       where s.license_expires_at is not null
      returning 1
    )
    select count(*) into v_inserted from ins;

  elsif p_kind = 'vehicles' then
    with src as (
      select distinct on (upper(regexp_replace(r.patente, '[^0-9A-Za-z]', '', 'g')))
             r.*
        from jsonb_array_elements(p_rows) with ordinality as e(value, ord)
       cross join lateral jsonb_to_record(e.value) as r(
               patente text, vehicle_type text, alias text, brand text, model text,
               year integer, fleet text, fuel_card text, capacity_kg numeric, notes text
             )
       order by upper(regexp_replace(r.patente, '[^0-9A-Za-z]', '', 'g')), e.ord
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

  elsif p_kind = 'client_tariffs' then
    -- One row per client, concept, area (NULL = every area) and start: the
    -- first one in the file wins and an existing tariff of that line with
    -- that start skips it. Any other overlap within the line is refused by
    -- guard_client_tariff_overlap and fails the run.
    with src as (
      select distinct on (r.client_id, r.concept, r.area_id, r.valid_from) r.*
        from jsonb_array_elements(p_rows) with ordinality as e(value, ord)
       cross join lateral jsonb_to_record(e.value) as r(
               client_id uuid, concept text, unit text, price numeric, currency text,
               valid_from date, valid_to date, notes text, area_id uuid
             )
       order by r.client_id, r.concept, r.area_id, r.valid_from, e.ord
    ),
    ins as (
      insert into public.client_tariffs (
        client_id, concept, unit, price, currency, valid_from, valid_to, notes,
        area_id, created_by, import_run_id
      )
      select s.client_id, s.concept, s.unit, s.price, coalesce(s.currency, 'ARS'),
             s.valid_from, s.valid_to, s.notes, s.area_id, p_user_id, v_run_id
        from src s
       where not exists (
               select 1 from public.client_tariffs t
                where t.client_id = s.client_id
                  and t.concept = s.concept
                  and t.area_id is not distinct from s.area_id
                  and t.valid_from = s.valid_from)
       order by s.client_id, s.concept, s.area_id, s.valid_from
      returning 1
    )
    select count(*) into v_inserted from ins;

  elsif p_kind = 'loans' then
    -- The loan and its schedule, as the loan dialog writes them. Same
    -- description, lender and first due date as a loan already loaded (or
    -- earlier in the file) = the same loan.
    for v_row in
      select r.*
        from jsonb_array_elements(p_rows) with ordinality as e(value, ord)
       cross join lateral jsonb_to_record(e.value) as r(
               kind text, description text, lender text, principal numeric,
               currency text, channel_id text, installments_count integer,
               first_due_date date, notes text, installments jsonb
             )
       order by e.ord
    loop
      if exists (
        select 1 from public.loans l
         where lower(regexp_replace(trim(l.description), '\s+', ' ', 'g'))
             = lower(regexp_replace(trim(v_row.description), '\s+', ' ', 'g'))
           and lower(regexp_replace(trim(coalesce(l.lender, '')), '\s+', ' ', 'g'))
             = lower(regexp_replace(trim(coalesce(v_row.lender, '')), '\s+', ' ', 'g'))
           and l.first_due_date = v_row.first_due_date
      ) then
        continue;
      end if;
      if v_row.installments is null
         or jsonb_typeof(v_row.installments) <> 'array'
         or jsonb_array_length(v_row.installments) <> v_row.installments_count then
        raise exception 'El cronograma del préstamo "%" no coincide con su cantidad de cuotas', v_row.description
          using errcode = '22023', hint = 'jouve_guard';
      end if;

      insert into public.loans (
        kind, description, lender, principal, currency, channel_id,
        installments_count, first_due_date, notes, created_by, import_run_id
      ) values (
        v_row.kind::public.loan_kind, v_row.description, v_row.lender, v_row.principal,
        v_row.currency, v_row.channel_id, v_row.installments_count, v_row.first_due_date,
        v_row.notes, p_user_id, v_run_id
      )
      returning id into v_loan_id;

      insert into public.loan_installments (loan_id, number, due_date, amount)
      select v_loan_id, i.number, i.due_date, i.amount
        from jsonb_to_recordset(v_row.installments) as i(
               number integer, due_date date, amount numeric
             );

      v_inserted := v_inserted + 1;
    end loop;

  elsif p_kind = 'checks' then
    if exists (
      select 1
        from jsonb_to_recordset(p_rows) as r(cartera_account_id uuid)
        left join public.accounts a on a.id = r.cartera_account_id
       where a.id is null or a.type not in ('checks', 'echeq')
    ) then
      raise exception 'La cuenta de cartera no es una cuenta de cheques'
        using errcode = '22023', hint = 'jouve_guard';
    end if;

    -- A check loaded by hand: checks_manual_inflow books its cartera inflow.
    -- Bank and number already loaded (checks_unique_number_per_bank_idx) =
    -- the same check.
    with ins as (
      insert into public.checks (
        kind, check_number, bank_name, drawer_name, drawer_cuit, issue_date, due_date,
        amount, currency, cartera_account_id, channel_id, source_kind, notes,
        created_by, import_run_id
      )
      select r.kind, r.check_number, r.bank_name, r.drawer_name, r.drawer_cuit,
             r.issue_date, r.due_date, r.amount, r.currency, r.cartera_account_id,
             r.channel_id, 'manual', r.notes, p_user_id, v_run_id
        from jsonb_to_recordset(p_rows) as r(
               kind text, check_number text, bank_name text, drawer_name text,
               drawer_cuit text, issue_date date, due_date date, amount numeric,
               currency text, cartera_account_id uuid, channel_id text, notes text
             )
      on conflict do nothing
      returning id, issue_date
    ),
    mov as (
      insert into public.check_movements (check_id, event, event_date, created_by)
      select i.id, 'received', i.issue_date, p_user_id from ins i
      returning 1
    )
    select count(*) into v_inserted from ins;

  elsif p_kind = 'opening_balances' then
    -- The owner's opening balance of each client, applied as the dialog does.
    -- A client that already has one (or appears earlier in the file) is
    -- skipped: the import never replaces a balance.
    for v_row in
      select r.*
        from jsonb_array_elements(p_rows) with ordinality as e(value, ord)
       cross join lateral jsonb_to_record(e.value) as r(
               client_id uuid, opening_date date, target_balance numeric, notes text
             )
       order by e.ord
    loop
      if exists (
        select 1 from public.client_opening_balances ob where ob.client_id = v_row.client_id
      ) then
        continue;
      end if;
      perform public.apply_client_opening_balance_core(
        v_row.client_id, v_row.opening_date, v_row.target_balance, v_row.notes,
        p_user_id, v_run_id
      );
      v_inserted := v_inserted + 1;
    end loop;

  elsif p_kind = 'bank_statement' then
    if exists (
      select 1
        from jsonb_to_recordset(p_rows) as r(account_id uuid)
        left join public.accounts a on a.id = r.account_id
       where a.id is null or a.type in ('checks', 'echeq')
    ) then
      raise exception 'El extracto es de una cuenta de banco, billetera, caja o inversión'
        using errcode = '22023', hint = 'jouve_guard';
    end if;

    with ins as (
      insert into public.bank_statement_lines (
        account_id, import_run_id, line_date, description, amount, balance,
        reference, source_hash, line_no
      )
      select r.account_id, v_run_id, r.line_date, r.description, r.amount, r.balance,
             r.reference, r.source_hash, r.line_no
        from jsonb_to_recordset(p_rows) as r(
               account_id uuid, line_date date, description text, amount numeric,
               balance numeric, reference text, source_hash text, line_no integer
             )
      on conflict (account_id, source_hash) do nothing
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
  'Registra una importación y sus filas en una transacción, salteando las que ya existen por su clave natural. Solo service role (la acción exige imports:write y el permiso del módulo).';

revoke all on function public.commit_import_run(text, text, text, jsonb, integer, integer, integer, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.commit_import_run(text, text, text, jsonb, integer, integer, integer, jsonb, uuid)
  to service_role;
