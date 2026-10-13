-- grant_vacation_balances declares OUT columns (employee_id, entitled_days,
-- carryover_days) with the same names as employee_vacation_balances columns.
-- Under plpgsql's default variable_conflict = error, the unqualified
-- `where employee_id = ...` and the carryover select raise 42702 (ambiguous
-- column), so every call fails. Recreate it with `#variable_conflict use_column`;
-- the OUT assignments (`employee_id := ...`) are not SQL and stay variables.
-- Body otherwise identical to 20260704140000_audit_t1a_security_lockdown.sql.

create or replace function public.grant_vacation_balances(
  p_target_year int default extract(year from now())::int,
  p_carryover   boolean default true
)
returns table (employee_id uuid, balance_id uuid, entitled_days int, carryover_days int)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_emp           record;
  v_anios         int;
  v_entitled      int;
  v_prev_balance  record;
  v_carry         int;
  v_balance_id    uuid;
  v_granted_at    date := make_date(p_target_year, 10, 1);
  v_expires_at    date := make_date(p_target_year + 1, 4, 30);
  v_dec31         date := make_date(p_target_year, 12, 31);
begin
  -- Audit T1: allow the service-role cron and authenticated owner/admin (the HR
  -- admin action); block anon and everyone else. See create_journal_entry note.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin']) then
    raise exception 'No autorizado para otorgar balances de vacaciones'
      using errcode = '42501';
  end if;

  update public.employee_vacation_balances
     set status = 'expired'
   where status = 'active'
     and expires_at < current_date;

  for v_emp in
    select id, hire_date
    from public.employees
    where is_active = true
  loop
    if exists (
      select 1 from public.employee_vacation_balances
      where employee_id = v_emp.id and period_year = p_target_year
    ) then
      continue;
    end if;

    v_anios := extract(year from age(v_dec31, v_emp.hire_date))::int;

    if v_emp.hire_date > make_date(p_target_year, 7, 1) then
      v_entitled := greatest(0, ((v_dec31 - v_emp.hire_date) / 20)::int);
    elsif v_anios < 5 then
      v_entitled := 14;
    elsif v_anios < 10 then
      v_entitled := 21;
    elsif v_anios < 20 then
      v_entitled := 28;
    else
      v_entitled := 35;
    end if;

    v_carry := 0;
    if p_carryover then
      select id,
             (entitled_days + bonus_days + carryover_days - used_days) as remaining
        into v_prev_balance
      from public.employee_vacation_balances
      where employee_id = v_emp.id and period_year = p_target_year - 1
      order by period_year desc
      limit 1;

      if found and v_prev_balance.remaining > 0 then
        v_carry := v_prev_balance.remaining;
      end if;
    end if;

    insert into public.employee_vacation_balances (
      employee_id, period_year, entitled_days, carryover_days,
      granted_at, expires_at, status, created_by
    )
    values (
      v_emp.id, p_target_year, v_entitled, v_carry,
      v_granted_at, v_expires_at, 'active', auth.uid()
    )
    returning id into v_balance_id;

    employee_id    := v_emp.id;
    balance_id     := v_balance_id;
    entitled_days  := v_entitled;
    carryover_days := v_carry;
    return next;
  end loop;
end;
$$;

revoke execute on function public.grant_vacation_balances(int, boolean) from public, anon;
grant  execute on function public.grant_vacation_balances(int, boolean) to authenticated, service_role;
