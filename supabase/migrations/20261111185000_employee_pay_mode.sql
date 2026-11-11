SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Employee pay mode («modalidad»): an employee is paid «por recibo» (the
-- salary is the payslip's net, loaded each month from the payroll provider's
-- recibo) or «sueldo acordado» (typed by hand and raised by %).
--
-- 1. employees.pay_mode ('recibo' | 'acordado', default 'acordado'), in the
--    fields create_employee / update_employee accept.
-- 2. apply_salary_raise skips 'recibo' employees: their raise comes with the
--    next recibo.
-- 3. For a 'recibo' employee:
--    * payroll_entries_follow_receipt (BEFORE): a loaded recibo_neto is the
--      entry's sueldo_neto (monthly and SAC entries), so a later write of
--      sueldo_neto (the final settlement) does not replace it; vacaciones
--      are always 0 (the recibo already pays them).
--    * payroll_entries_receipt_sets_base (AFTER, monthly periods): the recibo
--      of a month not older than the employee's latest salary change becomes
--      the base salary, logged as «Recibo MM/AAAA» from that month.
--    * employees_pay_mode_zero_vacations: switching an employee to 'recibo'
--      zeroes the vacaciones of their entries in draft periods (and, through
--      the BEFORE trigger, takes a loaded recibo as their sueldo). Closed
--      periods are never touched (their immutability trigger refuses it).
--    The view formula of total_a_pagar is unchanged: vacaciones are stored as
--    0 instead of masked, so closed periods keep their totals.
--
-- RLS unchanged. Rollback: older code never writes pay_mode and the default
-- keeps today's behaviour; an older apply_salary_raise caller sees 'recibo'
-- employees skipped.

-- 1. Column ------------------------------------------------------------------------

alter table public.employees
  add column pay_mode text not null default 'acordado';

-- Every row holds the default just added: the check is validated at once.
alter table public.employees
  -- squawk-ignore constraint-missing-not-valid
  add constraint employees_pay_mode_known
  check (pay_mode in ('recibo', 'acordado'));

comment on column public.employees.pay_mode is
  'recibo = el sueldo sale del recibo del liquidador; acordado = se carga a mano y se aumenta por %.';

-- Same as 20261106112001 plus pay_mode.
create or replace function public.employee_editable_fields()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'legal_name', 'position', 'cuil', 'cbu', 'pay_frequency', 'base_salary',
    'viatico_monthly', 'is_monotributo', 'hire_date', 'notes', 'convenio',
    'categoria', 'obra_social', 'art', 'retribucion_formal', 'pay_mode'
  ]::text[];
$$;

revoke all on function public.employee_editable_fields() from public, anon, authenticated;
grant execute on function public.employee_editable_fields() to authenticated, service_role;

-- 2. Raise ---------------------------------------------------------------------------

-- Same as 20261103060200 except: only 'acordado' employees are raised.
create or replace function public.apply_salary_raise(
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
       and e.pay_mode = 'acordado'
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
  'Aumento en % del sueldo base de los empleados activos con sueldo acordado elegidos desde un mes; actualiza las planillas en borrador desde ese mes que tenían el sueldo anterior. Deja el historial en employee_salary_changes. Los empleados por recibo no entran: su sueldo sale del recibo.';

revoke all on function public.apply_salary_raise(uuid[], numeric, date, text) from public, anon, authenticated;
grant execute on function public.apply_salary_raise(uuid[], numeric, date, text) to authenticated, service_role;

-- 3. The recibo is the salary of a 'recibo' employee ---------------------------------

create function public.payroll_entry_follow_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.employees e
     where e.id = new.employee_id and e.pay_mode = 'recibo'
  ) then
    return new;
  end if;

  new.vacaciones_monto := 0;
  if new.recibo_neto is not null then
    new.sueldo_neto := new.recibo_neto;
  end if;
  return new;
end;
$$;

comment on function public.payroll_entry_follow_receipt() is
  'Empleado por recibo: el recibo neto cargado es el sueldo de la línea (mensual y SAC) y las vacaciones van dentro del recibo (0).';

revoke all on function public.payroll_entry_follow_receipt() from public, anon, authenticated;

-- Fires after payroll_entries_apply_garnishment (triggers of one event run in
-- name order); that one reads coalesce(recibo_neto, sueldo_neto), the same
-- figure either way.
create trigger payroll_entries_follow_receipt
  before insert or update of recibo_neto, vacaciones_monto, sueldo_neto
  on public.payroll_entries
  for each row execute function public.payroll_entry_follow_receipt();

create function public.payroll_entry_receipt_sets_base()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date;
  v_kind  text;
begin
  if new.recibo_neto is null or new.recibo_neto <= 0 then
    return null;
  end if;

  select make_date(pp.year, pp.month, 1), pp.kind
    into v_month, v_kind
    from public.payroll_periods pp
   where pp.id = new.period_id;
  if v_kind is distinct from 'monthly' then
    return null;
  end if;

  if not exists (
    select 1 from public.employees e
     where e.id = new.employee_id
       and e.pay_mode = 'recibo'
       and e.base_salary is distinct from new.recibo_neto
  ) then
    return null;
  end if;

  -- An older recibo loaded late does not undo a newer salary.
  if exists (
    select 1 from public.employee_salary_changes c
     where c.employee_id = new.employee_id
       and c.effective_month > v_month
  ) then
    return null;
  end if;

  perform set_config('jouve.salary_change_month', v_month::text, true);
  perform set_config('jouve.salary_change_pct', '', true);
  perform set_config('jouve.salary_change_reason', 'Recibo ' || to_char(v_month, 'MM/YYYY'), true);

  update public.employees set base_salary = new.recibo_neto where id = new.employee_id;

  perform set_config('jouve.salary_change_month', '', true);
  perform set_config('jouve.salary_change_reason', '', true);
  return null;
end;
$$;

comment on function public.payroll_entry_receipt_sets_base() is
  'Empleado por recibo: el recibo neto de una planilla mensual no anterior al último cambio de sueldo pasa a ser su sueldo base desde ese mes («Recibo MM/AAAA»).';

revoke all on function public.payroll_entry_receipt_sets_base() from public, anon, authenticated;

create trigger payroll_entries_receipt_sets_base
  after insert or update of recibo_neto
  on public.payroll_entries
  for each row execute function public.payroll_entry_receipt_sets_base();

create function public.employee_pay_mode_zero_vacations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payroll_entries pe
     set vacaciones_monto = 0
    from public.payroll_periods pp
   where pp.id = pe.period_id
     and pp.status = 'draft'
     and pe.employee_id = new.id
     and (pe.vacaciones_monto <> 0
          or (pe.recibo_neto is not null and pe.sueldo_neto is distinct from pe.recibo_neto));
  return null;
end;
$$;

comment on function public.employee_pay_mode_zero_vacations() is
  'Al pasar un empleado a por recibo, sus vacaciones en planillas en borrador quedan en 0 (van dentro del recibo) y el recibo cargado pasa a ser el sueldo de la línea.';

revoke all on function public.employee_pay_mode_zero_vacations() from public, anon, authenticated;

create trigger employees_pay_mode_zero_vacations
  after update of pay_mode on public.employees
  for each row
  when (new.pay_mode = 'recibo' and old.pay_mode is distinct from new.pay_mode)
  execute function public.employee_pay_mode_zero_vacations();
