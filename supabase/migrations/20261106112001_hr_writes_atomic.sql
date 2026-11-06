SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- HR writes that ran as several statements from TypeScript, so a failure
-- halfway left a half-done state:
--
-- * applyFinalSettlementAction: planilla line, then delete of the settlement
--   extras, then insert of the SAC extra. A failed insert left the line
--   without its SAC.
-- * createEmployeeAction: employee, then driver record, then vacation days.
--   A failed later step answered "no se pudo" over an employee already
--   created, and saving the form again created it twice.
-- * updateEmployeeAction: employee, then driver record (name out of step).
-- * terminateEmployeeAction: notes read and rewritten (a concurrent edit
--   lost), then the driver deactivated in a separate write.
-- * setVacationOpeningAction: up to two balance rows, the second one could
--   fail after the first was written.
--
-- Each is now one function, one transaction. The rules are the ones the
-- TypeScript applied; the driver position stays a TypeScript constant
-- (DRIVER_POSITION) passed in as p_driver_position.
--
-- Also: a manual attendance upsert overwrote a leave_sync/holiday_sync row
-- and turned it into source 'manual', so deleting the leave no longer removed
-- it. Those rows belong to their source (docs/hr-patterns.md §4: the grid
-- shows them read-only and only manual rows are deleted), so an update of
-- one is refused. sync_attendance_from_leave only inserts and deletes them.
--
-- Rollback: older code does not call these functions. The attendance guard
-- also holds for older code: its upsert over a synced day gets the guard's
-- message instead of overwriting it.

-- ---------------------------------------------------------------------------
-- Final settlement
-- ---------------------------------------------------------------------------

-- Writes the final settlement on the employee's line of the month (creating
-- the planilla and the line when missing) and replaces the settlement extras
-- (those whose description starts with p_extra_prefix) with the SAC one.
-- payroll_entries_enforce_immutability refuses it on a closed planilla.
create or replace function public.apply_final_settlement(
  p_employee_id     uuid,
  p_year            int,
  p_month           int,
  p_sueldo_neto     numeric,
  p_vacaciones_monto numeric,
  p_extra_prefix    text,
  p_sac_amount      numeric,
  p_sac_description text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_period_id uuid;
  v_entry_id  uuid;
begin
  if coalesce(p_extra_prefix, '') = '' then
    raise exception 'p_extra_prefix is required';
  end if;

  v_period_id := public.seed_payroll_period(p_year, p_month);

  insert into public.payroll_entries (period_id, employee_id, sueldo_neto, vacaciones_monto)
  values (v_period_id, p_employee_id, p_sueldo_neto, p_vacaciones_monto)
  on conflict (period_id, employee_id) do update
    set sueldo_neto = excluded.sueldo_neto,
        vacaciones_monto = excluded.vacaciones_monto
  returning id into v_entry_id;

  delete from public.payroll_entry_extras
   where entry_id = v_entry_id
     and left(description, length(p_extra_prefix)) = p_extra_prefix;

  if p_sac_amount > 0 then
    insert into public.payroll_entry_extras (entry_id, amount, description, sort_order, created_by)
    values (v_entry_id, p_sac_amount, p_sac_description, 900, auth.uid());
  end if;

  return v_entry_id;
end;
$$;

revoke all on function public.apply_final_settlement(uuid, int, int, numeric, numeric, text, numeric, text) from public, anon, authenticated;
grant execute on function public.apply_final_settlement(uuid, int, int, numeric, numeric, text, numeric, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Vacation opening (from features/hr/lib/vacation-opening.ts)
-- ---------------------------------------------------------------------------

-- Writes the vacation days HR loads by hand. The period in course (from
-- October 1 the current year, before it the previous one) gets p_current_days
-- as its days (entitled + extra); the days pending from earlier years land on
-- the previous period's row, `extended` so they stay usable after April 30.
-- Both leave the balance showing exactly the figure entered. A null figure
-- leaves its period untouched. Returns the period in course.
-- SECURITY INVOKER: the balances' RLS lets only owner/admin write; the role
-- check below also holds when create_employee (definer) calls it.
create or replace function public.set_vacation_opening(
  p_employee_id   uuid,
  p_today         date,
  p_current_days  int default null,
  p_previous_days int default null
)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_year    int := extract(year from p_today)::int
                   - case when to_char(p_today, 'MM-DD') >= '10-01' then 0 else 1 end;
  v_row     public.employee_vacation_balances%rowtype;
  v_days    int;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin']) then
    raise exception 'Solo el dueño o un administrador pueden cargar saldos de vacaciones.'
      using errcode = '42501';
  end if;

  if p_current_days is not null then
    select * into v_row from public.employee_vacation_balances
     where employee_id = p_employee_id and period_year = v_year
     for update;
    if found then
      -- The period's own days: what was already used still counts against it.
      v_days := p_current_days - v_row.bonus_days;
      if v_days < 0 then
        raise exception 'El período % ya tiene más días tomados o asignados que los que querés cargar.', v_year
          using errcode = '23514', hint = 'jouve_guard';
      end if;
      update public.employee_vacation_balances
         set entitled_days = v_days, status = 'active'
       where id = v_row.id;
    else
      insert into public.employee_vacation_balances
        (employee_id, period_year, entitled_days, granted_at, expires_at, status, notes, created_by)
      values
        (p_employee_id, v_year, p_current_days, make_date(v_year, 10, 1), make_date(v_year + 1, 4, 30),
         'active', 'Días del período cargados a mano', auth.uid());
    end if;
  end if;

  if p_previous_days is not null then
    select * into v_row from public.employee_vacation_balances
     where employee_id = p_employee_id and period_year = v_year - 1
     for update;
    if found then
      -- What is left to take equals the figure entered.
      v_days := p_previous_days + v_row.used_days - v_row.bonus_days - v_row.carryover_days;
      if v_days < 0 then
        raise exception 'El período % ya tiene más días tomados o asignados que los que querés cargar.', v_year - 1
          using errcode = '23514', hint = 'jouve_guard';
      end if;
      update public.employee_vacation_balances
         set entitled_days = v_days,
             status = case
               when p_previous_days > 0 then 'extended'
               when v_row.status = 'extended' then 'expired'
               else v_row.status
             end
       where id = v_row.id;
    elsif p_previous_days > 0 then
      insert into public.employee_vacation_balances
        (employee_id, period_year, entitled_days, granted_at, expires_at, status, notes, created_by)
      values
        (p_employee_id, v_year - 1, p_previous_days, make_date(v_year - 1, 10, 1), make_date(v_year, 4, 30),
         'extended', 'Días pendientes de años anteriores cargados a mano', auth.uid());
    end if;
  end if;

  return v_year;
end;
$$;

revoke all on function public.set_vacation_opening(uuid, date, int, int) from public, anon, authenticated;
grant execute on function public.set_vacation_opening(uuid, date, int, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Employee and driver record (from features/hr/lib/employee-driver.ts)
-- ---------------------------------------------------------------------------

-- Keeps the employee's driver record in step with the employee: a driver
-- creates or updates it (name and CUIT from the employee row, license and
-- phone when p_driver carries those keys), anyone else has it deactivated
-- (trips keep their history). Internal: only the definer functions below
-- call it, after their own role check.
create or replace function public.sync_employee_driver(
  p_employee_id uuid,
  p_is_driver   boolean,
  p_driver      jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name    text;
  v_cuil    text;
  v_driver  public.drivers%rowtype;
  v_payload jsonb := coalesce(p_driver, '{}'::jsonb);
begin
  select legal_name, cuil into v_name, v_cuil
    from public.employees where id = p_employee_id;

  select * into v_driver from public.drivers
   where employee_id = p_employee_id
   order by created_at
   limit 1
   for update;

  if not p_is_driver then
    if found and v_driver.is_active then
      update public.drivers set is_active = false, full_name = v_name
       where id = v_driver.id;
    end if;
    return;
  end if;

  if found then
    update public.drivers
       set full_name = v_name,
           cuit = v_cuil,
           is_active = true,
           license_number = case when v_payload ? 'license_number'
                                 then v_payload ->> 'license_number' else license_number end,
           license_category = case when v_payload ? 'license_category'
                                   then v_payload ->> 'license_category' else license_category end,
           phone = case when v_payload ? 'phone' then v_payload ->> 'phone' else phone end
     where id = v_driver.id;
  else
    insert into public.drivers
      (employee_id, full_name, cuit, is_active, license_number, license_category, phone, created_by)
    values
      (p_employee_id, v_name, v_cuil, true, v_payload ->> 'license_number',
       v_payload ->> 'license_category', v_payload ->> 'phone', auth.uid());
  end if;
end;
$$;

revoke all on function public.sync_employee_driver(uuid, boolean, jsonb) from public, anon, authenticated;

-- Fields createEmployeeAction / updateEmployeeAction write on employees.
create or replace function public.employee_editable_fields()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'legal_name', 'position', 'cuil', 'cbu', 'pay_frequency', 'base_salary',
    'viatico_monthly', 'is_monotributo', 'hire_date', 'notes', 'convenio',
    'categoria', 'obra_social', 'art', 'retribucion_formal'
  ]::text[];
$$;

revoke all on function public.employee_editable_fields() from public, anon, authenticated;
grant execute on function public.employee_editable_fields() to authenticated, service_role;

-- Creates the employee (p_employee: the editable fields plus created_by), its
-- driver record when its position is p_driver_position, and, when either
-- figure is given, its vacation days (owner/admin only). All or nothing.
-- SECURITY DEFINER: the drivers' RLS leaves finance (who manages HR) out;
-- the role check below is the employees' RLS (hr:write).
create or replace function public.create_employee(
  p_employee        jsonb,
  p_driver_position text,
  p_driver          jsonb,
  p_today           date,
  p_current_days    int default null,
  p_previous_days   int default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields text[] := public.employee_editable_fields() || array['created_by'];
  v_cols   text;
  v_vals   text;
  v_id     uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para crear empleados' using errcode = '42501';
  end if;
  if p_employee is null or jsonb_typeof(p_employee) <> 'object' then
    raise exception 'p_employee must be a jsonb object';
  end if;
  if exists (select 1 from jsonb_object_keys(p_employee) k where k <> all (v_fields)) then
    raise exception 'p_employee has a field that is not editable';
  end if;

  select string_agg(format('%I', f), ', '), string_agg(format('r.%I', f), ', ')
    into v_cols, v_vals
    from unnest(v_fields) f
   where p_employee ? f;

  execute format(
    'insert into public.employees (%s) select %s from jsonb_populate_record(null::public.employees, $1) r returning id',
    v_cols, v_vals
  ) into v_id using p_employee;

  if p_employee ->> 'position' = p_driver_position then
    perform public.sync_employee_driver(v_id, true, p_driver);
  end if;

  if p_current_days is not null or p_previous_days is not null then
    perform public.set_vacation_opening(v_id, p_today, p_current_days, p_previous_days);
  end if;

  return v_id;
end;
$$;

revoke all on function public.create_employee(jsonb, text, jsonb, date, int, int) from public, anon, authenticated;
grant execute on function public.create_employee(jsonb, text, jsonb, date, int, int) to authenticated, service_role;

-- Writes the fields present in p_patch and keeps the driver record in step.
-- Only a change away from the driver position deactivates it: rows saved
-- before the positions list (free text) keep their driver as it is. Returns
-- the previous legal_name and base_salary (for the audit), or null when the
-- employee does not exist; then nothing is written.
create or replace function public.update_employee(
  p_id              uuid,
  p_patch           jsonb,
  p_driver_position text,
  p_driver          jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields     text[] := public.employee_editable_fields();
  v_old        public.employees%rowtype;
  v_set        text;
  v_position   text;
  v_is_driver  boolean;
  v_left       boolean;
  v_driver_on  boolean;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para editar empleados' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'p_patch must be a jsonb object';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k <> all (v_fields)) then
    raise exception 'p_patch has a field that is not editable';
  end if;

  select * into v_old from public.employees where id = p_id for update;
  if not found then
    return null;
  end if;

  select string_agg(format('%I = r.%I', f, f), ', ')
    into v_set
    from unnest(v_fields) f
   where p_patch ? f;
  if v_set is not null then
    execute format(
      'update public.employees t set %s from jsonb_populate_record(null::public.employees, $2) r where t.id = $1',
      v_set
    ) using p_id, p_patch;
  end if;

  v_position := case when p_patch ? 'position' then p_patch ->> 'position' else v_old.position end;
  v_is_driver := v_position is not distinct from p_driver_position;
  v_left := v_old.position is not distinct from p_driver_position and not v_is_driver;
  select d.is_active into v_driver_on
    from public.drivers d
   where d.employee_id = p_id
   order by d.created_at
   limit 1;
  if v_is_driver or v_left or v_driver_on is not null then
    perform public.sync_employee_driver(
      p_id, v_is_driver or (not v_left and coalesce(v_driver_on, false)), p_driver);
  end if;

  return jsonb_build_object('legal_name', v_old.legal_name, 'base_salary', v_old.base_salary);
end;
$$;

revoke all on function public.update_employee(uuid, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.update_employee(uuid, jsonb, text, jsonb) to authenticated, service_role;

-- Terminates the employee: termination date, inactive, the reason appended
-- to the notes (never replacing them), and its driver record deactivated so
-- it leaves the trip pickers. Returns false when the employee does not exist.
create or replace function public.terminate_employee(
  p_id               uuid,
  p_termination_date date,
  p_reason           text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para dar de baja empleados' using errcode = '42501';
  end if;

  update public.employees
     set termination_date = p_termination_date,
         is_active = false,
         notes = case
           when nullif(p_reason, '') is null then notes
           when nullif(notes, '') is null then p_reason
           else notes || E'\n\n' || p_reason
         end
   where id = p_id;
  if not found then
    return false;
  end if;

  update public.drivers set is_active = false
   where employee_id = p_id and is_active;

  return true;
end;
$$;

revoke all on function public.terminate_employee(uuid, date, text) from public, anon, authenticated;
grant execute on function public.terminate_employee(uuid, date, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Attendance: a synced day is changed from its source
-- ---------------------------------------------------------------------------

create or replace function public.guard_attendance_synced_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.source <> 'manual' then
    raise exception 'Ese día lo carga una licencia o un feriado: cambialo desde su origen, no desde la asistencia.'
      using errcode = '55000', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_attendance_synced_row() from public, anon, authenticated;

create trigger attendance_records_synced_row_guard
  before update on public.attendance_records
  for each row execute function public.guard_attendance_synced_row();
