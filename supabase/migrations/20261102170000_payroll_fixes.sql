SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Payroll fixes:
--   1. enforce_payroll_period_immutability returned NEW from its BEFORE DELETE
--      branches. NEW is NULL on DELETE, so Postgres silently skipped every
--      delete of a payroll extra or entry ("Extra eliminado" removed nothing
--      and the amount kept adding to the total to pay). It now returns OLD on
--      DELETE; the closed-period rule is unchanged.
--   2. guard_payroll_payment_account: payroll_payment_sync_transaction always
--      writes an ARS expense, so a payroll payment must come from an active ARS
--      cash/bank account, never from a USD account or a check portfolio.
--      Existing rows are not touched; the guard runs on insert and on a change
--      of account.
--   3. fill_payroll_period: adds a draft entry for every active employee that
--      is missing from an open period (hired or reactivated after the period
--      was generated). seed_payroll_period now uses it, so both share one rule
--      for the defaults (viático; base salary for mensual/mixto).

-- 1. Deletes of payroll entries and extras ------------------------------------

create or replace function public.enforce_payroll_period_immutability()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  if tg_table_name = 'payroll_periods' then
    if old.status = 'closed' and new.status = 'closed' then
      if new.year is distinct from old.year
         or new.month is distinct from old.month then
        raise exception
          'Período cerrado (id=%): año/mes son inmutables', old.id
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'payroll_entries' then
    select status into v_status
    from public.payroll_periods
    where id = coalesce(new.period_id, old.period_id);
    if v_status = 'closed' then
      raise exception
        'Período cerrado: no se pueden modificar entries (period_id=%)',
        coalesce(new.period_id, old.period_id)
        using errcode = '23514';
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_table_name = 'payroll_entry_extras' then
    select pp.status into v_status
    from public.payroll_entries pe
    join public.payroll_periods pp on pp.id = pe.period_id
    where pe.id = coalesce(new.entry_id, old.entry_id);
    if v_status = 'closed' then
      raise exception
        'Período cerrado: no se pueden modificar extras (entry_id=%)',
        coalesce(new.entry_id, old.entry_id)
        using errcode = '23514';
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- 2. Payroll payments only from an active ARS cash/bank account ----------------

create or replace function public.guard_payroll_payment_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_currency  text;
  v_type      text;
  v_is_active boolean;
begin
  if tg_op = 'UPDATE' and new.account_id is not distinct from old.account_id then
    return new;
  end if;

  select a.currency, a.type, a.is_active
    into v_currency, v_type, v_is_active
  from public.accounts a
  where a.id = new.account_id;

  if v_currency is null then
    raise exception 'La cuenta del pago de sueldo no existe.'
      using errcode = '23503';
  end if;
  if v_currency <> 'ARS' then
    raise exception 'Los sueldos se pagan desde una cuenta en pesos (la cuenta elegida es en %).', v_currency
      using errcode = '23514';
  end if;
  if v_type in ('checks', 'echeq') then
    raise exception 'Los sueldos no se pagan desde una cartera de cheques.'
      using errcode = '23514';
  end if;
  if not v_is_active then
    raise exception 'La cuenta elegida está inactiva.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_payroll_payment_account() from public, anon, authenticated;

create trigger payroll_payments_guard_account
  before insert or update of account_id on public.payroll_payments
  for each row execute function public.guard_payroll_payment_account();

-- 3. Missing employees in an open period --------------------------------------

create or replace function public.fill_payroll_period(p_period_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_added  integer;
begin
  if not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'Sin permisos para modificar liquidaciones.'
      using errcode = '42501';
  end if;

  select status into v_status
  from public.payroll_periods
  where id = p_period_id;

  if v_status is null then
    raise exception 'El período no existe.' using errcode = 'P0002';
  end if;
  if v_status = 'closed' then
    raise exception 'El período está cerrado: reabrilo para agregar empleados.'
      using errcode = '23514';
  end if;

  insert into public.payroll_entries (
    period_id, employee_id, sueldo_neto, viaticos, created_by
  )
  select
    p_period_id,
    e.id,
    case when e.pay_frequency in ('mensual', 'mixto') then coalesce(e.base_salary, 0)
         else 0
    end,
    coalesce(e.viatico_monthly, 0),
    auth.uid()
  from public.employees e
  where e.is_active = true
  on conflict (period_id, employee_id) do nothing;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

comment on function public.fill_payroll_period(uuid) is
  'Adds a draft entry for each active employee missing from an open payroll period. Defaults: viático; base salary for mensual/mixto.';

create or replace function public.seed_payroll_period(
  p_year  int,
  p_month int
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_period_id uuid;
begin
  if not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'Sin permisos para crear períodos de liquidación.'
      using errcode = '42501';
  end if;

  -- Idempotent: an existing period is returned as is.
  select id into v_period_id
  from public.payroll_periods
  where year = p_year and month = p_month;

  if v_period_id is not null then
    return v_period_id;
  end if;

  insert into public.payroll_periods (year, month, created_by)
  values (p_year, p_month, auth.uid())
  returning id into v_period_id;

  perform public.fill_payroll_period(v_period_id);

  return v_period_id;
end;
$$;
