SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Creating a planilla (monthly or SAC) says whether it created it.
--
-- seed_payroll_period and seed_sac_period return the period's id whether
-- they created it or found it, so seedPayrollPeriodAction and
-- seedSacPeriodAction logged "payroll.period_created" /
-- "payroll.sac_period_created" also for a period that already existed. They
-- also read first and inserted after: two creations at once both read
-- nothing and the second failed on payroll_periods_year_month_kind_key.
--
-- create_payroll_period and create_sac_period insert with ON CONFLICT DO
-- NOTHING on (year, month, kind) and return the id and whether this call
-- created it (it fills the entries only then). seed_payroll_period and
-- seed_sac_period keep their signature and return the id from them.
--
-- No table changes. Existing rows are not touched.
--
-- Rollback: older code calls seed_*, which keep their arguments and result.

create function public.create_payroll_period(p_year int, p_month int)
returns table (period_id uuid, created boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_period_id uuid;
begin
  if not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'Sin permisos para crear períodos de liquidación.'
      using errcode = '42501';
  end if;

  insert into public.payroll_periods (year, month, kind, created_by)
  values (p_year, p_month, 'monthly', auth.uid())
  on conflict (year, month, kind) do nothing
  returning id into v_period_id;

  if v_period_id is not null then
    perform public.fill_payroll_period(v_period_id);
    return query select v_period_id, true;
    return;
  end if;

  return query
    select p.id, false
      from public.payroll_periods p
     where p.year = p_year and p.month = p_month and p.kind = 'monthly';
end;
$$;

comment on function public.create_payroll_period(int, int) is
  'Crea (idempotentemente) la planilla mensual con sus líneas; devuelve el id y si esta llamada la creó.';

revoke all on function public.create_payroll_period(int, int) from public, anon;
grant execute on function public.create_payroll_period(int, int) to authenticated, service_role;

create function public.create_sac_period(p_year int, p_half int)
returns table (period_id uuid, created boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_period_id uuid;
  v_month     int;
begin
  if not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'Sin permisos para crear períodos de liquidación.'
      using errcode = '42501';
  end if;
  if p_half is null or p_half not in (1, 2) then
    raise exception 'El semestre del SAC es 1 o 2.'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  v_month := case when p_half = 1 then 6 else 12 end;

  insert into public.payroll_periods (year, month, kind, created_by)
  values (p_year, v_month, 'sac', auth.uid())
  on conflict (year, month, kind) do nothing
  returning id into v_period_id;

  if v_period_id is not null then
    perform public.fill_payroll_period(v_period_id);
    return query select v_period_id, true;
    return;
  end if;

  return query
    select p.id, false
      from public.payroll_periods p
     where p.year = p_year and p.month = v_month and p.kind = 'sac';
end;
$$;

comment on function public.create_sac_period(int, int) is
  'Crea (idempotentemente) el período de SAC del semestre (mes 6 o 12) con el SAC sugerido; devuelve el id y si esta llamada lo creó.';

revoke all on function public.create_sac_period(int, int) from public, anon;
grant execute on function public.create_sac_period(int, int) to authenticated, service_role;

-- Same arguments and result as 20261103050100, through the functions above.
create or replace function public.seed_payroll_period(p_year int, p_month int)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select period_id from public.create_payroll_period(p_year, p_month);
$$;

create or replace function public.seed_sac_period(p_year int, p_half int)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select period_id from public.create_sac_period(p_year, p_half);
$$;
