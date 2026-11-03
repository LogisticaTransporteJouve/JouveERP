SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Aumentos en % (roadmap 3.6).
--
--   1. employee_salary_changes: the history of employees.base_salary. Every
--      change writes a row (trigger employees_log_salary_change): a hand edit
--      takes effect in the current month (Argentina); apply_salary_raise
--      states its month, percentage and reason. Read-only for the app.
--   2. employee_salary_for_month(employee, month): the agreed salary for a
--      month — the previous salary of the first change that takes effect
--      after it, or the current base salary when none does.
--   3. apply_salary_raise(employee ids, %, month, reason): raises the base
--      salary of each active employee with one, and the agreed salary of
--      their entries in draft monthly periods from that month on that still
--      hold the previous base salary (a salary typed by hand is kept).
--   4. fill_payroll_period: a monthly period seeds the salary for its month
--      (employee_salary_for_month), so a raise effective from a later month
--      does not reach an earlier planilla generated after it.
--
-- Existing employees have no history: their salary for any month is the base
-- salary, as before.

-- 1. History -------------------------------------------------------------------------

create table public.employee_salary_changes (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.employees (id) on delete cascade,
  effective_month  date not null,
  previous_salary  numeric(15, 2),
  new_salary       numeric(15, 2),
  raise_percentage numeric(6, 2),
  reason           text check (length(reason) <= 200),
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),

  constraint employee_salary_changes_month check (effective_month = date_trunc('month', effective_month)::date)
);

comment on table public.employee_salary_changes is
  'Historial del sueldo base del empleado: anterior, nuevo, mes desde el que rige y, si vino de un aumento masivo, su porcentaje y motivo. Lo escribe el trigger de employees.';

create index employee_salary_changes_employee_idx
  on public.employee_salary_changes (employee_id, effective_month);

alter table public.employee_salary_changes enable row level security;

create policy "hr can read salary changes"
  on public.employee_salary_changes for select
  to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

revoke all on table public.employee_salary_changes from public, anon;
revoke insert, update, delete on table public.employee_salary_changes from authenticated;

create function public.employee_log_salary_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.employee_salary_changes (
    employee_id, effective_month, previous_salary, new_salary, raise_percentage, reason, created_by
  ) values (
    new.id,
    coalesce(
      nullif(current_setting('jouve.salary_change_month', true), '')::date,
      date_trunc('month', (now() at time zone 'America/Argentina/Buenos_Aires'))::date
    ),
    old.base_salary,
    new.base_salary,
    nullif(current_setting('jouve.salary_change_pct', true), '')::numeric,
    nullif(current_setting('jouve.salary_change_reason', true), ''),
    auth.uid()
  );
  return null;
end;
$$;

revoke all on function public.employee_log_salary_change() from public, anon, authenticated;

create trigger employees_log_salary_change
  after update of base_salary on public.employees
  for each row
  when (old.base_salary is distinct from new.base_salary)
  execute function public.employee_log_salary_change();

-- 2. Salary for a month ----------------------------------------------------------------

create function public.employee_salary_for_month(p_employee_id uuid, p_month date)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select case when later.found then later.previous_salary else e.base_salary end
  from public.employees e
  left join lateral (
    select true as found, c.previous_salary
    from public.employee_salary_changes c
    where c.employee_id = e.id
      and c.effective_month > date_trunc('month', p_month)::date
    order by c.effective_month, c.created_at
    limit 1
  ) later on true
  where e.id = p_employee_id;
$$;

comment on function public.employee_salary_for_month(uuid, date) is
  'Sueldo base vigente en el mes: el anterior del primer cambio que rige después, o el sueldo base actual. Security invoker.';

revoke all on function public.employee_salary_for_month(uuid, date) from public, anon;
grant execute on function public.employee_salary_for_month(uuid, date) to authenticated, service_role;

-- 3. Raise ---------------------------------------------------------------------------------

create function public.apply_salary_raise(
  p_employee_ids    uuid[],
  p_percentage      numeric,
  p_effective_month date,
  p_reason          text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_effective_month)::date;
  v_emp   record;
  v_new   numeric;
  v_count integer := 0;
begin
  -- Role guard (hr:write holders in lib/auth/permissions.ts).
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para aplicar aumentos de sueldo'
      using errcode = '42501';
  end if;
  if p_percentage is null or p_percentage <= 0 or p_percentage > 100 then
    raise exception 'El aumento tiene que ser mayor a 0%% y hasta 100%%'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if p_effective_month is null then
    raise exception 'Indicá el mes desde el que rige el aumento'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if p_employee_ids is null or cardinality(p_employee_ids) = 0 then
    raise exception 'Elegí al menos un empleado'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  perform set_config('jouve.salary_change_month', v_month::text, true);
  perform set_config('jouve.salary_change_pct', p_percentage::text, true);
  perform set_config('jouve.salary_change_reason', left(coalesce(btrim(p_reason), ''), 200), true);

  for v_emp in
    select e.id, e.base_salary, e.pay_frequency
      from public.employees e
     where e.id = any (p_employee_ids)
       and e.is_active
       and e.base_salary > 0
     order by e.id
       for update
  loop
    v_new := round(v_emp.base_salary * (1 + p_percentage / 100), 2);
    update public.employees set base_salary = v_new where id = v_emp.id;

    if v_emp.pay_frequency in ('mensual', 'mixto') then
      update public.payroll_entries pe
         set sueldo_neto = v_new
        from public.payroll_periods pp
       where pp.id = pe.period_id
         and pp.status = 'draft'
         and pp.kind = 'monthly'
         and make_date(pp.year, pp.month, 1) >= v_month
         and pe.employee_id = v_emp.id
         and pe.sueldo_neto = v_emp.base_salary;
    end if;
    v_count := v_count + 1;
  end loop;

  perform set_config('jouve.salary_change_month', '', true);
  perform set_config('jouve.salary_change_pct', '', true);
  perform set_config('jouve.salary_change_reason', '', true);
  return v_count;
end;
$$;

comment on function public.apply_salary_raise(uuid[], numeric, date, text) is
  'Aumento en % del sueldo base de los empleados activos elegidos desde un mes; actualiza las planillas en borrador desde ese mes que tenían el sueldo anterior. Deja el historial en employee_salary_changes.';

revoke all on function public.apply_salary_raise(uuid[], numeric, date, text) from public, anon, authenticated;
grant execute on function public.apply_salary_raise(uuid[], numeric, date, text) to authenticated, service_role;

-- 4. Seeding with the salary of the month -------------------------------------------------

-- Same as 20261103050100 except the monthly salary: employee_salary_for_month.
create or replace function public.fill_payroll_period(p_period_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_kind   text;
  v_year   int;
  v_month  int;
  v_added  integer;
begin
  if not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'Sin permisos para modificar liquidaciones.'
      using errcode = '42501';
  end if;

  select status, kind, year, month into v_status, v_kind, v_year, v_month
  from public.payroll_periods
  where id = p_period_id;

  if v_status is null then
    raise exception 'El período no existe.'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if v_status = 'closed' then
    raise exception 'El período está cerrado: reabrilo para agregar empleados.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  insert into public.payroll_entries (
    period_id, employee_id, sueldo_neto, viaticos, created_by
  )
  select
    p_period_id,
    e.id,
    case
      when v_kind = 'sac' then
        coalesce(public.payroll_sac_suggestion(e.id, v_year, case when v_month = 6 then 1 else 2 end), 0)
      when e.pay_frequency in ('mensual', 'mixto') then
        coalesce(public.employee_salary_for_month(e.id, make_date(v_year, v_month, 1)), 0)
      else 0
    end,
    case when v_kind = 'sac' then 0 else coalesce(e.viatico_monthly, 0) end,
    auth.uid()
  from public.employees e
  where e.is_active = true
    and (v_kind <> 'sac' or e.hire_date <= make_date(v_year, v_month, 1) + interval '1 month' - interval '1 day')
  on conflict (period_id, employee_id) do nothing;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

comment on function public.fill_payroll_period(uuid) is
  'Adds a draft entry for each active employee missing from an open payroll period. Monthly: viático and the salary for the month (employee_salary_for_month) for mensual/mixto. SAC: the suggested SAC, no viático.';
