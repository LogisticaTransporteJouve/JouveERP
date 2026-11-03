SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- SAC (aguinaldo) as its own payroll period (roadmap 3.2).
--
--   1. payroll_periods.kind: 'monthly' (every existing row) or 'sac'. A SAC
--      period sits on the month it is due (6 = first half, 12 = second half),
--      so its payments accrue there and the payroll aggregates (management
--      P&L, AI summaries) count it in that month. The unique key becomes
--      (year, month, kind).
--   2. payroll_sac_suggestion(employee, year, half): 50% of the best monthly
--      remuneration (agreed salary + extras) of the half's monthly periods,
--      prorated by the days the employee worked in the half (hire or
--      termination inside it). A suggestion: the SAC entry stays editable.
--   3. fill_payroll_period: a SAC period gets the suggestion as its salary
--      and no viático, for employees hired by the end of the half.
--      seed_payroll_period only looks at monthly periods; seed_sac_period
--      creates the SAC one.
--   4. payroll_payment_sync_transaction names a SAC payment "SAC <name>
--      (1.er/2.º semestre YYYY)". The posting is unchanged.

-- 1. Period kind --------------------------------------------------------------------

alter table public.payroll_periods
  add column kind text not null default 'monthly';

alter table public.payroll_periods
  -- squawk-ignore constraint-missing-not-valid
  add constraint payroll_periods_kind_known check (kind in ('monthly', 'sac')),
  -- squawk-ignore constraint-missing-not-valid
  add constraint payroll_periods_sac_month check (kind <> 'sac' or month in (6, 12));

comment on column public.payroll_periods.kind is
  'monthly = planilla del mes; sac = aguinaldo del semestre (mes 6 = 1.er semestre, 12 = 2.º).';

-- squawk-ignore require-concurrent-index-creation
create unique index payroll_periods_year_month_kind_key
  on public.payroll_periods (year, month, kind);

alter table public.payroll_periods
  -- squawk-ignore ban-drop-constraint
  drop constraint payroll_periods_year_month_key;

-- 2. SAC suggestion -----------------------------------------------------------------

create function public.payroll_sac_suggestion(
  p_employee_id uuid,
  p_year int,
  p_half int
)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  with sem as (
    select make_date(p_year, case when p_half = 1 then 1 else 7 end, 1) as d_from,
           case when p_half = 1 then make_date(p_year, 6, 30) else make_date(p_year, 12, 31) end as d_to
  ),
  best as (
    select max(r.sueldo_neto + r.extras_total) as amount
    from public.payroll_periods pp
    join public.v_payroll_entries_resolved r on r.period_id = pp.id
    where pp.kind = 'monthly'
      and pp.year = p_year
      and pp.month between (case when p_half = 1 then 1 else 7 end)
                       and (case when p_half = 1 then 6 else 12 end)
      and r.employee_id = p_employee_id
  ),
  span as (
    select greatest(e.hire_date, sem.d_from) as d_start,
           least(coalesce(e.termination_date, sem.d_to), sem.d_to) as d_end,
           sem.d_to - sem.d_from + 1 as days_total
    from public.employees e
    cross join sem
    where e.id = p_employee_id
  )
  select case
           when best.amount is null or span.d_end < span.d_start then 0
           else round(best.amount / 2 * (span.d_end - span.d_start + 1) / span.days_total, 2)
         end
  from best
  cross join span;
$$;

comment on function public.payroll_sac_suggestion(uuid, int, int) is
  'SAC sugerido: 50% de la mejor remuneración mensual (sueldo pactado + extras) del semestre, proporcional a los días trabajados en él. Security invoker.';

revoke all on function public.payroll_sac_suggestion(uuid, int, int) from public, anon;
grant execute on function public.payroll_sac_suggestion(uuid, int, int) to authenticated, service_role;

-- 3. Seeding --------------------------------------------------------------------------

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
      when e.pay_frequency in ('mensual', 'mixto') then coalesce(e.base_salary, 0)
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
  'Adds a draft entry for each active employee missing from an open payroll period. Monthly: viático and base salary for mensual/mixto. SAC: the suggested SAC, no viático.';

create or replace function public.seed_payroll_period(
  p_year  int,
  p_month int
)
returns uuid
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

  -- Idempotent: an existing monthly period is returned as is.
  select id into v_period_id
  from public.payroll_periods
  where year = p_year and month = p_month and kind = 'monthly';

  if v_period_id is not null then
    return v_period_id;
  end if;

  insert into public.payroll_periods (year, month, kind, created_by)
  values (p_year, p_month, 'monthly', auth.uid())
  returning id into v_period_id;

  perform public.fill_payroll_period(v_period_id);

  return v_period_id;
end;
$$;

create function public.seed_sac_period(
  p_year int,
  p_half int
)
returns uuid
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

  select id into v_period_id
  from public.payroll_periods
  where year = p_year and month = v_month and kind = 'sac';

  if v_period_id is not null then
    return v_period_id;
  end if;

  insert into public.payroll_periods (year, month, kind, created_by)
  values (p_year, v_month, 'sac', auth.uid())
  returning id into v_period_id;

  perform public.fill_payroll_period(v_period_id);

  return v_period_id;
end;
$$;

comment on function public.seed_sac_period(int, int) is
  'Crea (idempotentemente) el período de SAC del semestre (mes 6 o 12) con el SAC sugerido para cada empleado activo.';

revoke all on function public.seed_sac_period(int, int) from public, anon;
grant execute on function public.seed_sac_period(int, int) to authenticated, service_role;

-- 4. Payment description ------------------------------------------------------------

create or replace function public.payroll_payment_sync_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period_year   int;
  v_period_month  int;
  v_period_kind   text;
  v_employee_name text;
  v_accrual       date;
  v_description   text;
begin
  if tg_op = 'INSERT' then
    select pp.year, pp.month, pp.kind, e.legal_name
      into v_period_year, v_period_month, v_period_kind, v_employee_name
    from public.payroll_entries pe
    join public.payroll_periods pp on pp.id = pe.period_id
    join public.employees e on e.id = pe.employee_id
    where pe.id = new.entry_id;

    v_accrual := make_date(v_period_year, v_period_month, 1);
    v_description :=
      case when v_period_kind = 'sac' then
        'SAC ' || v_employee_name
        || ' (' || case when v_period_month = 6 then '1.er' else '2.º' end
        || ' semestre ' || v_period_year::text || ')'
      else
        'Sueldo ' || v_employee_name
        || ' (' || lpad(v_period_month::text, 2, '0') || '/' || v_period_year::text || ')'
      end
      || coalesce(' — ' || nullif(new.notes, ''), '');

    insert into public.transactions (
      account_id, channel_id, kind, amount, currency,
      transaction_date, accrual_month, description, created_by, is_payroll
    )
    values (
      new.account_id, new.channel_id, 'expense', new.amount, 'ARS',
      new.paid_at, v_accrual, v_description, new.created_by, true
    )
    returning id into new.transaction_id;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.transaction_id is not null then
      update public.transactions
         set account_id       = new.account_id,
             channel_id       = new.channel_id,
             amount           = new.amount,
             transaction_date = new.paid_at,
             updated_at       = now()
       where id = new.transaction_id;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.transaction_id is not null then
      delete from public.transactions where id = old.transaction_id;
    end if;
    return old;
  end if;

  return null;
end;
$$;

revoke all on function public.payroll_payment_sync_transaction() from public, anon, authenticated;
