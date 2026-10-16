-- AI CFO phase 1: read-only business aggregates behind the assistant's action
-- registry (features/ai/registry) and the gated read actions that wrap them.
--
-- Every function is LANGUAGE sql, STABLE, SECURITY INVOKER with a pinned
-- search_path: the caller's RLS applies exactly as on a direct PostgREST read,
-- so an aggregate never exposes a row the caller could not already select.
-- Callers are server actions that run requireUserContext() + userCan() and use
-- the RLS user client. EXECUTE is revoked from public/anon/authenticated by name
-- and granted back to authenticated only.
--
-- Money: sales/purchase documents are converted to ARS with the document's own
-- `cotizacion`; receipts and payment orders, which carry no rate, are split by
-- currency; open balances from the aging views are split by `moneda` (PES vs
-- other). Results are bounded by p_limit (capped server-side) or by the natural
-- cardinality of the grouping (months, employees, categories).

set lock_timeout = '10s';

set row_security = off;

------------------------------------------------------------------------------
-- 1. Payroll / HR
------------------------------------------------------------------------------

-- Payroll totals per month (YYYY-MM) or per employee over [p_from_period,
-- p_to_period]. Concepts are the columns payroll_entries stores: net salary
-- (sueldo_neto), free-text extras, vacation pay, travel allowance (viaticos),
-- and the deductions deudas and telefono. total_a_pagar, paid and saldo come
-- from v_payroll_entries_with_payments. The schema stores net pay only: there
-- is no gross salary or employer contributions column.
create or replace function public.ai_payroll_summary(
  p_from_period text,
  p_to_period text,
  p_group_by text default 'month',
  p_employee_id uuid default null
)
returns table(
  group_key text,
  label text,
  periods integer,
  employees integer,
  sueldo_neto numeric,
  extras numeric,
  vacaciones numeric,
  viaticos numeric,
  deudas numeric,
  telefono numeric,
  total_a_pagar numeric,
  paid numeric,
  saldo numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with sel_periods as (
    select pp.id, to_char(make_date(pp.year, pp.month, 1), 'YYYY-MM') as period
    from public.payroll_periods pp
    where to_char(make_date(pp.year, pp.month, 1), 'YYYY-MM') between p_from_period and p_to_period
  ),
  ent as (
    select
      p.period,
      r.employee_id,
      e.legal_name,
      r.sueldo_neto,
      r.extras_total,
      r.vacaciones_monto,
      r.viaticos,
      r.deudas,
      r.telefono,
      r.total_a_pagar,
      r.paid_total,
      r.saldo
    from sel_periods p
    join public.v_payroll_entries_with_payments r on r.period_id = p.id
    join public.employees e on e.id = r.employee_id
    where p_employee_id is null or r.employee_id = p_employee_id
  )
  select
    case when p_group_by = 'employee' then ent.employee_id::text else ent.period end,
    case when p_group_by = 'employee' then ent.legal_name else ent.period end,
    count(distinct ent.period)::integer,
    count(distinct ent.employee_id)::integer,
    coalesce(sum(ent.sueldo_neto), 0),
    coalesce(sum(ent.extras_total), 0),
    coalesce(sum(ent.vacaciones_monto), 0),
    coalesce(sum(ent.viaticos), 0),
    coalesce(sum(ent.deudas), 0),
    coalesce(sum(ent.telefono), 0),
    coalesce(sum(ent.total_a_pagar), 0),
    coalesce(sum(ent.paid_total), 0),
    coalesce(sum(ent.saldo), 0)
  from ent
  group by 1, 2
  order by
    case when p_group_by = 'employee' then coalesce(sum(ent.total_a_pagar), 0) else 0 end desc,
    1;
$$;

revoke all on function public.ai_payroll_summary(text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.ai_payroll_summary(text, text, text, uuid) to authenticated;

comment on function public.ai_payroll_summary(text, text, text, uuid) is
  'Payroll totals per month or per employee (net salary, extras, vacation pay, viaticos, deductions, total, paid, balance). Security invoker.';

-- Payroll amounts per concept over [p_from_period, p_to_period]: the fixed
-- columns (deductions negative) plus every free-text extra grouped by its
-- normalized description. p_drivers_only keeps employees paid weekly or linked
-- to a drivers row the caller can see.
create or replace function public.ai_payroll_concepts(
  p_from_period text,
  p_to_period text,
  p_drivers_only boolean default false
)
returns table(
  concept text,
  kind text,
  amount numeric,
  entries integer,
  employees integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with ent as (
    select pe.id, pe.employee_id, pe.sueldo_neto, pe.vacaciones_monto, pe.viaticos, pe.deudas, pe.telefono
    from public.payroll_periods pp
    join public.payroll_entries pe on pe.period_id = pp.id
    join public.employees e on e.id = pe.employee_id
    where to_char(make_date(pp.year, pp.month, 1), 'YYYY-MM') between p_from_period and p_to_period
      and (
        not p_drivers_only
        or e.pay_frequency = 'semanal'
        or exists (select 1 from public.drivers d where d.employee_id = e.id)
      )
  ),
  concept_lines as (
    select v.concept, 'fijo'::text as kind, v.amount, ent.id as entry_id, ent.employee_id
    from ent
    cross join lateral (
      values
        ('sueldo_neto', ent.sueldo_neto),
        ('vacaciones', ent.vacaciones_monto),
        ('viaticos', ent.viaticos),
        ('deudas', -ent.deudas),
        ('telefono', -ent.telefono)
    ) as v(concept, amount)
    where v.amount <> 0
    union all
    select lower(btrim(x.description)), 'extra'::text, x.amount, ent.id, ent.employee_id
    from ent
    join public.payroll_entry_extras x on x.entry_id = ent.id
  )
  select
    cl.concept,
    cl.kind,
    sum(cl.amount),
    count(distinct cl.entry_id)::integer,
    count(distinct cl.employee_id)::integer
  from concept_lines cl
  group by cl.concept, cl.kind
  order by cl.kind desc, abs(sum(cl.amount)) desc
  limit 200;
$$;

revoke all on function public.ai_payroll_concepts(text, text, boolean) from public, anon, authenticated;
grant execute on function public.ai_payroll_concepts(text, text, boolean) to authenticated;

comment on function public.ai_payroll_concepts(text, text, boolean) is
  'Payroll amounts per concept (fixed columns + normalized free-text extras), optionally drivers only. Security invoker.';

-- Extras per driver (employee paid weekly or linked to a visible drivers row)
-- and month over [p_from_period, p_to_period].
create or replace function public.ai_driver_extras(
  p_from_period text,
  p_to_period text
)
returns table(
  employee_id uuid,
  legal_name text,
  period text,
  extras_total numeric,
  extras_count integer,
  viaticos numeric,
  sueldo_neto numeric,
  total_a_pagar numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    r.employee_id,
    e.legal_name,
    to_char(make_date(pp.year, pp.month, 1), 'YYYY-MM') as period,
    coalesce(r.extras_total, 0),
    (select count(*) from public.payroll_entry_extras x where x.entry_id = r.id)::integer,
    coalesce(r.viaticos, 0),
    coalesce(r.sueldo_neto, 0),
    coalesce(r.total_a_pagar, 0)
  from public.payroll_periods pp
  join public.v_payroll_entries_resolved r on r.period_id = pp.id
  join public.employees e on e.id = r.employee_id
  where to_char(make_date(pp.year, pp.month, 1), 'YYYY-MM') between p_from_period and p_to_period
    and (
      e.pay_frequency = 'semanal'
      or exists (select 1 from public.drivers d where d.employee_id = e.id)
    )
  order by 3, 4 desc, 2
  limit 1000;
$$;

revoke all on function public.ai_driver_extras(text, text) from public, anon, authenticated;
grant execute on function public.ai_driver_extras(text, text) to authenticated;

comment on function public.ai_driver_extras(text, text) is
  'Payroll extras per driver and month (weekly-paid employees or employees linked to a visible drivers row). Security invoker.';

-- Vacation position per active employee at p_as_of: days entitled (entitled +
-- bonus + carryover), used and remaining over the non-expired balances, the
-- remaining days that expire within p_expiring_days, the next expiry, and the
-- vacation days taken in p_as_of's calendar year (employee_leaves).
create or replace function public.ai_vacation_overview(
  p_as_of date default current_date,
  p_expiring_days integer default 90
)
returns table(
  employee_id uuid,
  legal_name text,
  entitled_days integer,
  used_days integer,
  remaining_days integer,
  expiring_days integer,
  next_expiry date,
  taken_this_year integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    e.id,
    e.legal_name,
    coalesce(sum(b.entitled_days + b.bonus_days + b.carryover_days), 0)::integer,
    coalesce(sum(b.used_days), 0)::integer,
    coalesce(sum(b.entitled_days + b.bonus_days + b.carryover_days - b.used_days), 0)::integer,
    coalesce(
      sum(b.entitled_days + b.bonus_days + b.carryover_days - b.used_days)
        filter (where b.expires_at <= p_as_of + p_expiring_days),
      0
    )::integer,
    min(b.expires_at)
      filter (where b.entitled_days + b.bonus_days + b.carryover_days - b.used_days > 0),
    coalesce(max(taken.days), 0)::integer
  from public.employees e
  left join public.employee_vacation_balances b
    on b.employee_id = e.id
   and b.status in ('active', 'extended')
   and b.expires_at >= p_as_of
  left join lateral (
    select sum(
      least(l.end_date, make_date(extract(year from p_as_of)::integer, 12, 31))
      - greatest(l.start_date, make_date(extract(year from p_as_of)::integer, 1, 1))
      + 1
    ) as days
    from public.employee_leaves l
    where l.employee_id = e.id
      and l.kind = 'vacaciones'
      and l.start_date <= make_date(extract(year from p_as_of)::integer, 12, 31)
      and l.end_date >= make_date(extract(year from p_as_of)::integer, 1, 1)
  ) taken on true
  where e.is_active
  group by e.id, e.legal_name
  order by 5 desc, 2;
$$;

revoke all on function public.ai_vacation_overview(date, integer) from public, anon, authenticated;
grant execute on function public.ai_vacation_overview(date, integer) to authenticated;

comment on function public.ai_vacation_overview(date, integer) is
  'Vacation entitled/used/remaining/expiring days per active employee plus days taken this year. Security invoker.';

-- Leaves per employee and kind overlapping [p_from, p_to]; days are the
-- calendar days of each leave that fall inside the range.
create or replace function public.ai_leaves_summary(
  p_from date,
  p_to date
)
returns table(
  employee_id uuid,
  legal_name text,
  kind text,
  leaves integer,
  days integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    l.employee_id,
    e.legal_name,
    l.kind::text,
    count(*)::integer,
    sum(least(l.end_date, p_to) - greatest(l.start_date, p_from) + 1)::integer
  from public.employee_leaves l
  join public.employees e on e.id = l.employee_id
  where l.start_date <= p_to
    and l.end_date >= p_from
  group by l.employee_id, e.legal_name, l.kind
  order by 2, 3;
$$;

revoke all on function public.ai_leaves_summary(date, date) from public, anon, authenticated;
grant execute on function public.ai_leaves_summary(date, date) to authenticated;

comment on function public.ai_leaves_summary(date, date) is
  'Leaves per employee and kind with the days inside [p_from, p_to]. Security invoker.';

-- Attendance events per employee and kind in [p_from, p_to].
create or replace function public.ai_attendance_summary(
  p_from date,
  p_to date
)
returns table(
  employee_id uuid,
  legal_name text,
  kind text,
  events integer,
  hours_lost numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    a.employee_id,
    e.legal_name,
    a.kind::text,
    count(*)::integer,
    coalesce(sum(a.hours_lost), 0)
  from public.attendance_records a
  join public.employees e on e.id = a.employee_id
  where a.date between p_from and p_to
  group by a.employee_id, e.legal_name, a.kind
  order by 2, 3;
$$;

revoke all on function public.ai_attendance_summary(date, date) from public, anon, authenticated;
grant execute on function public.ai_attendance_summary(date, date) to authenticated;

comment on function public.ai_attendance_summary(date, date) is
  'Attendance events and hours lost per employee and kind in [p_from, p_to]. Security invoker.';

------------------------------------------------------------------------------
-- 2. Accounting
------------------------------------------------------------------------------

-- Journal totals per account type and income-statement category for the
-- accrual periods <= p_period_end (and >= p_period_start when given),
-- optionally for one cost center. Cumulative (no start) gives the balance
-- sheet; a range over result accounts gives the income statement.
create or replace function public.ai_account_type_totals(
  p_period_end text,
  p_period_start text default null,
  p_cost_center_id uuid default null
)
returns table(
  account_type text,
  eerr_category text,
  accounts integer,
  total_debit numeric,
  total_credit numeric,
  balance numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coa.account_type::text,
    coalesce(coa.eerr_category, ''),
    count(distinct coa.id)::integer,
    sum(jel.debit),
    sum(jel.credit),
    sum(jel.debit - jel.credit)
  from public.journal_entry_lines jel
  join public.journal_entries je on je.id = jel.journal_entry_id
  join public.chart_of_accounts coa on coa.id = jel.chart_of_accounts_id
  where je.accrual_period <= p_period_end
    and (p_period_start is null or je.accrual_period >= p_period_start)
    and (p_cost_center_id is null or je.cost_center_id = p_cost_center_id)
  group by 1, 2
  order by 1, 2;
$$;

revoke all on function public.ai_account_type_totals(text, text, uuid) from public, anon, authenticated;
grant execute on function public.ai_account_type_totals(text, text, uuid) to authenticated;

comment on function public.ai_account_type_totals(text, text, uuid) is
  'Debit/credit/balance per account type and EERR category for an accrual-period range, optionally per cost center. Security invoker.';

-- Result-account totals per cost center (null = no cost center) and account
-- type over [p_period_start, p_period_end].
create or replace function public.ai_cost_center_breakdown(
  p_period_start text,
  p_period_end text
)
returns table(
  cost_center_id uuid,
  cost_center_code text,
  cost_center_name text,
  account_type text,
  total_debit numeric,
  total_credit numeric,
  balance numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    je.cost_center_id,
    coalesce(cc.code, ''),
    coalesce(cc.name, 'Sin centro de costo'),
    coa.account_type::text,
    sum(jel.debit),
    sum(jel.credit),
    sum(jel.debit - jel.credit)
  from public.journal_entry_lines jel
  join public.journal_entries je on je.id = jel.journal_entry_id
  join public.chart_of_accounts coa on coa.id = jel.chart_of_accounts_id
  left join public.cost_centers cc on cc.id = je.cost_center_id
  where je.accrual_period between p_period_start and p_period_end
    and coa.account_type in ('resultado_positivo', 'resultado_negativo')
  group by je.cost_center_id, cc.code, cc.name, coa.account_type
  order by 2, 4;
$$;

revoke all on function public.ai_cost_center_breakdown(text, text) from public, anon, authenticated;
grant execute on function public.ai_cost_center_breakdown(text, text) to authenticated;

comment on function public.ai_cost_center_breakdown(text, text) is
  'Result-account totals per cost center and account type for an accrual-period range. Security invoker.';

-- Expense (debit − credit on resultado_negativo accounts) per accrual period
-- and category (the account's EERR category, else its name).
create or replace function public.ai_expense_by_category(
  p_period_start text,
  p_period_end text
)
returns table(
  period text,
  category text,
  amount numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    je.accrual_period,
    coalesce(nullif(coa.eerr_category, ''), coa.name),
    sum(jel.debit - jel.credit)
  from public.journal_entry_lines jel
  join public.journal_entries je on je.id = jel.journal_entry_id
  join public.chart_of_accounts coa on coa.id = jel.chart_of_accounts_id
  where je.accrual_period between p_period_start and p_period_end
    and coa.account_type = 'resultado_negativo'
  group by 1, 2
  order by 1, 3 desc
  limit 1000;
$$;

revoke all on function public.ai_expense_by_category(text, text) from public, anon, authenticated;
grant execute on function public.ai_expense_by_category(text, text) to authenticated;

comment on function public.ai_expense_by_category(text, text) is
  'Expense per accrual period and category (EERR category or account name). Security invoker.';

------------------------------------------------------------------------------
-- 3. Fleet
------------------------------------------------------------------------------

-- Margin over [p_from, p_to] grouped by trip, driver, vehicle or client, with
-- the same imputation as the fleet profitability report: a trip carries its
-- revenue, its cost and the fuel loads tied to it; a vehicle also carries
-- every fuel load and maintenance record in the range. By client, each trip's
-- revenue and costs are split across its non-cancelled shipments by freight
-- share (equal split when no freight is set); trips without shipments go to
-- 'none'. Window totals cover every group, not only the returned page.
create or replace function public.ai_fleet_margin(
  p_from date,
  p_to date,
  p_group_by text default 'vehicle',
  p_limit integer default 50
)
returns table(
  group_key text,
  label text,
  trips integer,
  revenue numeric,
  trip_cost numeric,
  fuel_cost numeric,
  maintenance_cost numeric,
  net numeric,
  margin_pct numeric,
  total_groups integer,
  total_revenue numeric,
  total_net numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with trips_in as (
    select
      tr.id,
      tr.trip_date,
      tr.vehicle_id,
      tr.driver_id,
      tr.origin,
      tr.destination,
      coalesce(tr.revenue, 0)::numeric as revenue,
      coalesce(tr.cost, 0)::numeric as trip_cost
    from public.trips tr
    where tr.trip_date between p_from and p_to
  ),
  fuel_in as (
    select fl.vehicle_id, fl.trip_id, fl.amount
    from public.fuel_loads fl
    where fl.load_date between p_from and p_to
  ),
  trip_rows as (
    select t.*, coalesce(tf.amount, 0)::numeric as fuel_cost
    from trips_in t
    left join (
      select fuel_in.trip_id, sum(fuel_in.amount) as amount
      from fuel_in
      where fuel_in.trip_id is not null
      group by fuel_in.trip_id
    ) tf on tf.trip_id = t.id
  ),
  ship as (
    select
      s.trip_id,
      s.client_id,
      coalesce(s.freight_amount, 0)::numeric as freight,
      sum(coalesce(s.freight_amount, 0)) over (partition by s.trip_id) as trip_freight,
      count(*) over (partition by s.trip_id) as trip_shipments
    from public.shipments s
    where s.trip_id in (select trips_in.id from trips_in)
      and s.status <> 'cancelled'
  ),
  grouped as (
    select
      tr.id::text as k,
      to_char(tr.trip_date, 'YYYY-MM-DD') || ' ' || coalesce(tr.origin, '?') || ' → ' || coalesce(tr.destination, '?') as lbl,
      1 as n_trips,
      tr.revenue as rev,
      tr.trip_cost as tcost,
      tr.fuel_cost as fcost,
      0::numeric as mcost
    from trip_rows tr
    where p_group_by = 'trip'
    union all
    select
      coalesce(tr.driver_id::text, 'none'),
      coalesce(d.full_name, 'Sin chofer'),
      count(*)::integer,
      sum(tr.revenue),
      sum(tr.trip_cost),
      sum(tr.fuel_cost),
      0::numeric
    from trip_rows tr
    left join public.drivers d on d.id = tr.driver_id
    where p_group_by = 'driver'
    group by 1, 2
    union all
    select
      v.id::text,
      v.patente,
      coalesce(tv.n, 0)::integer,
      coalesce(tv.revenue, 0),
      coalesce(tv.trip_cost, 0),
      coalesce(vf.amount, 0),
      coalesce(mt.cost, 0)
    from public.vehicles v
    left join (
      select trip_rows.vehicle_id, count(*) as n, sum(trip_rows.revenue) as revenue, sum(trip_rows.trip_cost) as trip_cost
      from trip_rows
      group by trip_rows.vehicle_id
    ) tv on tv.vehicle_id = v.id
    left join (
      select fuel_in.vehicle_id, sum(fuel_in.amount) as amount
      from fuel_in
      group by fuel_in.vehicle_id
    ) vf on vf.vehicle_id = v.id
    left join (
      select m.vehicle_id, sum(coalesce(m.cost, 0)) as cost
      from public.maintenance_records m
      where m.service_date between p_from and p_to
      group by m.vehicle_id
    ) mt on mt.vehicle_id = v.id
    where p_group_by = 'vehicle'
      and (tv.vehicle_id is not null or vf.vehicle_id is not null or mt.vehicle_id is not null)
    union all
    select
      coalesce(a.client_id::text, 'none'),
      coalesce(c.legal_name, 'Sin cliente asignado'),
      count(distinct a.id)::integer,
      sum(a.revenue * a.share),
      sum(a.trip_cost * a.share),
      sum(a.fuel_cost * a.share),
      0::numeric
    from (
      select
        tr.id,
        tr.revenue,
        tr.trip_cost,
        tr.fuel_cost,
        sh.client_id,
        case
          when sh.trip_id is null then 1::numeric
          when sh.trip_freight > 0 then sh.freight / sh.trip_freight
          else 1::numeric / sh.trip_shipments
        end as share
      from trip_rows tr
      left join ship sh on sh.trip_id = tr.id
    ) a
    left join public.clients c on c.id = a.client_id
    where p_group_by = 'client'
    group by 1, 2
  )
  select
    g.k,
    g.lbl,
    g.n_trips::integer,
    round(g.rev, 2),
    round(g.tcost, 2),
    round(g.fcost, 2),
    round(g.mcost, 2),
    round(g.rev - g.tcost - g.fcost - g.mcost, 2),
    case when g.rev <> 0 then round((g.rev - g.tcost - g.fcost - g.mcost) / g.rev * 100, 1) end,
    (count(*) over ())::integer,
    round(sum(g.rev) over (), 2),
    round(sum(g.rev - g.tcost - g.fcost - g.mcost) over (), 2)
  from grouped g
  order by 8 desc, 2
  limit greatest(1, least(p_limit, 500));
$$;

revoke all on function public.ai_fleet_margin(date, date, text, integer) from public, anon, authenticated;
grant execute on function public.ai_fleet_margin(date, date, text, integer) to authenticated;

comment on function public.ai_fleet_margin(date, date, text, integer) is
  'Fleet margin per trip/driver/vehicle/client with fuel and maintenance imputation and window totals. Security invoker.';

------------------------------------------------------------------------------
-- 4. Clients
------------------------------------------------------------------------------

-- Per client over [p_from, p_to]: invoiced in ARS (emitted invoices and debit
-- notes minus credit notes, at each document's cotizacion), collected by
-- currency (issued receipts), the amount-weighted average days from invoice
-- date to receipt date for the receipts in range, and the current open and
-- overdue balance (due date, else invoice date + 30 days). Window totals cover
-- every client, not only the returned page.
create or replace function public.ai_client_sales_summary(
  p_from date,
  p_to date,
  p_client_id uuid default null,
  p_limit integer default 50
)
returns table(
  client_id uuid,
  legal_name text,
  invoiced_ars numeric,
  invoices integer,
  credit_notes integer,
  collected_ars numeric,
  collected_usd numeric,
  receipts integer,
  avg_days_to_pay numeric,
  open_ars numeric,
  open_foreign numeric,
  overdue_ars numeric,
  total_clients integer,
  total_invoiced_ars numeric,
  total_collected_ars numeric,
  total_open_ars numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with inv as (
    select
      i.client_id,
      sum(case when i.kind = 'nc' then -1 else 1 end * i.imp_total * coalesce(nullif(i.cotizacion, 0), 1)) as invoiced_ars,
      count(*) filter (where i.kind <> 'nc') as invoices,
      count(*) filter (where i.kind = 'nc') as credit_notes
    from public.invoices i
    where i.status = 'emitted'
      and i.fecha between p_from and p_to
      and (p_client_id is null or i.client_id = p_client_id)
    group by i.client_id
  ),
  rec as (
    select
      r.client_id,
      sum(r.total_amount) filter (where r.currency = 'ARS') as collected_ars,
      sum(r.total_amount) filter (where r.currency = 'USD') as collected_usd,
      count(*) as receipts
    from public.receipts r
    where r.status = 'issued'
      and r.receipt_date between p_from and p_to
      and (p_client_id is null or r.client_id = p_client_id)
    group by r.client_id
  ),
  dtp as (
    select
      r.client_id,
      sum((r.receipt_date - i.fecha) * ra.amount_applied) / nullif(sum(ra.amount_applied), 0) as avg_days
    from public.receipts r
    join public.receipt_allocations ra on ra.receipt_id = r.id
    join public.invoices i on i.id = ra.invoice_id
    where r.status = 'issued'
      and r.receipt_date between p_from and p_to
      and (p_client_id is null or r.client_id = p_client_id)
    group by r.client_id
  ),
  debt as (
    select
      d.client_id,
      sum(d.open_amount) filter (where d.moneda = 'PES') as open_ars,
      sum(d.open_amount) filter (where d.moneda <> 'PES') as open_foreign,
      sum(d.open_amount) filter (
        where d.moneda = 'PES' and coalesce(d.fch_vto_pago, d.fecha + 30) < current_date
      ) as overdue_ars
    from public.v_aging_documents d
    where p_client_id is null or d.client_id = p_client_id
    group by d.client_id
  ),
  keys as (
    select inv.client_id from inv
    union
    select rec.client_id from rec
    union
    select debt.client_id from debt
  )
  select
    k.client_id,
    c.legal_name,
    round(coalesce(inv.invoiced_ars, 0), 2),
    coalesce(inv.invoices, 0)::integer,
    coalesce(inv.credit_notes, 0)::integer,
    coalesce(rec.collected_ars, 0),
    coalesce(rec.collected_usd, 0),
    coalesce(rec.receipts, 0)::integer,
    round(dtp.avg_days, 1),
    coalesce(debt.open_ars, 0),
    coalesce(debt.open_foreign, 0),
    coalesce(debt.overdue_ars, 0),
    (count(*) over ())::integer,
    round(sum(coalesce(inv.invoiced_ars, 0)) over (), 2),
    sum(coalesce(rec.collected_ars, 0)) over (),
    sum(coalesce(debt.open_ars, 0)) over ()
  from keys k
  join public.clients c on c.id = k.client_id
  left join inv on inv.client_id = k.client_id
  left join rec on rec.client_id = k.client_id
  left join dtp on dtp.client_id = k.client_id
  left join debt on debt.client_id = k.client_id
  order by 3 desc, 10 desc, 2
  limit greatest(1, least(p_limit, 500));
$$;

revoke all on function public.ai_client_sales_summary(date, date, uuid, integer) from public, anon, authenticated;
grant execute on function public.ai_client_sales_summary(date, date, uuid, integer) to authenticated;

comment on function public.ai_client_sales_summary(date, date, uuid, integer) is
  'Per-client invoiced (ARS), collected (by currency), average days to pay and open/overdue balance with window totals. Security invoker.';

------------------------------------------------------------------------------
-- 5. Suppliers
------------------------------------------------------------------------------

-- Per supplier over [p_from, p_to]: purchased in ARS (received invoices and
-- debit notes minus credit notes, at each document's cotizacion), paid by
-- currency (issued payment orders), the current open and overdue balance
-- (due date, else invoice date + the supplier's payment term) and the next due
-- date. Window totals cover every supplier, not only the returned page.
create or replace function public.ai_supplier_purchases_summary(
  p_from date,
  p_to date,
  p_supplier_id uuid default null,
  p_category_id uuid default null,
  p_limit integer default 50
)
returns table(
  supplier_id uuid,
  legal_name text,
  category text,
  purchased_ars numeric,
  net_ars numeric,
  invoices integer,
  paid_ars numeric,
  paid_usd numeric,
  open_ars numeric,
  open_foreign numeric,
  overdue_ars numeric,
  next_due_date date,
  total_suppliers integer,
  total_purchased_ars numeric,
  total_open_ars numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with pur as (
    select
      pi.supplier_id,
      sum(case when pi.kind = 'nc' then -1 else 1 end * pi.imp_total * coalesce(nullif(pi.cotizacion, 0), 1)) as purchased_ars,
      sum(case when pi.kind = 'nc' then -1 else 1 end * pi.imp_neto * coalesce(nullif(pi.cotizacion, 0), 1)) as net_ars,
      count(*) filter (where pi.kind <> 'nc') as invoices
    from public.purchase_invoices pi
    where pi.status = 'received'
      and pi.fecha between p_from and p_to
      and (p_supplier_id is null or pi.supplier_id = p_supplier_id)
    group by pi.supplier_id
  ),
  paid as (
    select
      po.supplier_id,
      sum(po.total_amount) filter (where po.currency = 'ARS') as paid_ars,
      sum(po.total_amount) filter (where po.currency = 'USD') as paid_usd
    from public.payment_orders po
    where po.status = 'issued'
      and po.payment_date between p_from and p_to
      and (p_supplier_id is null or po.supplier_id = p_supplier_id)
    group by po.supplier_id
  ),
  docs as (
    select
      d.supplier_id,
      d.open_amount,
      d.moneda,
      coalesce(d.fch_vto_pago, d.fecha + coalesce(s.default_payment_term_days, 0)) as due_date
    from public.v_supplier_aging_documents d
    join public.suppliers s on s.id = d.supplier_id
    where p_supplier_id is null or d.supplier_id = p_supplier_id
  ),
  debt as (
    select
      docs.supplier_id,
      sum(docs.open_amount) filter (where docs.moneda = 'PES') as open_ars,
      sum(docs.open_amount) filter (where docs.moneda <> 'PES') as open_foreign,
      sum(docs.open_amount) filter (where docs.moneda = 'PES' and docs.due_date < current_date) as overdue_ars,
      min(docs.due_date) filter (where docs.due_date >= current_date) as next_due_date
    from docs
    group by docs.supplier_id
  ),
  keys as (
    select pur.supplier_id from pur
    union
    select paid.supplier_id from paid
    union
    select debt.supplier_id from debt
  )
  select
    k.supplier_id,
    s.legal_name,
    coalesce(sc.name, ''),
    round(coalesce(pur.purchased_ars, 0), 2),
    round(coalesce(pur.net_ars, 0), 2),
    coalesce(pur.invoices, 0)::integer,
    coalesce(paid.paid_ars, 0),
    coalesce(paid.paid_usd, 0),
    coalesce(debt.open_ars, 0),
    coalesce(debt.open_foreign, 0),
    coalesce(debt.overdue_ars, 0),
    debt.next_due_date,
    (count(*) over ())::integer,
    round(sum(coalesce(pur.purchased_ars, 0)) over (), 2),
    sum(coalesce(debt.open_ars, 0)) over ()
  from keys k
  join public.suppliers s on s.id = k.supplier_id
  left join public.supplier_categories sc on sc.id = s.category_id
  left join pur on pur.supplier_id = k.supplier_id
  left join paid on paid.supplier_id = k.supplier_id
  left join debt on debt.supplier_id = k.supplier_id
  where p_category_id is null or s.category_id = p_category_id
  order by 4 desc, 9 desc, 2
  limit greatest(1, least(p_limit, 500));
$$;

revoke all on function public.ai_supplier_purchases_summary(date, date, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.ai_supplier_purchases_summary(date, date, uuid, uuid, integer) to authenticated;

comment on function public.ai_supplier_purchases_summary(date, date, uuid, uuid, integer) is
  'Per-supplier purchases (ARS), payments (by currency), open/overdue balance and next due date with window totals. Security invoker.';

-- Open supplier documents due on or before today + p_days (overdue ones
-- included), soonest first. Window totals cover every matching document.
create or replace function public.ai_supplier_upcoming_dues(
  p_days integer default 30,
  p_supplier_id uuid default null,
  p_limit integer default 100
)
returns table(
  purchase_invoice_id uuid,
  supplier_id uuid,
  legal_name text,
  kind text,
  letter text,
  punto_venta integer,
  numero integer,
  fecha date,
  due_date date,
  days_to_due integer,
  open_amount numeric,
  moneda text,
  total_documents integer,
  total_open_ars numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with docs as (
    select
      d.purchase_invoice_id,
      d.supplier_id,
      s.legal_name,
      d.kind,
      d.letter,
      d.punto_venta,
      d.numero,
      d.fecha,
      coalesce(d.fch_vto_pago, d.fecha + coalesce(s.default_payment_term_days, 0)) as due_date,
      d.open_amount,
      d.moneda
    from public.v_supplier_aging_documents d
    join public.suppliers s on s.id = d.supplier_id
    where p_supplier_id is null or d.supplier_id = p_supplier_id
  )
  select
    docs.purchase_invoice_id,
    docs.supplier_id,
    docs.legal_name,
    docs.kind,
    coalesce(docs.letter::text, ''),
    docs.punto_venta,
    docs.numero,
    docs.fecha,
    docs.due_date,
    (docs.due_date - current_date)::integer,
    docs.open_amount,
    docs.moneda,
    (count(*) over ())::integer,
    sum(case when docs.moneda = 'PES' then docs.open_amount else 0 end) over ()
  from docs
  where docs.due_date <= current_date + greatest(0, least(p_days, 365))
  order by docs.due_date, docs.legal_name
  limit greatest(1, least(p_limit, 500));
$$;

revoke all on function public.ai_supplier_upcoming_dues(integer, uuid, integer) from public, anon, authenticated;
grant execute on function public.ai_supplier_upcoming_dues(integer, uuid, integer) to authenticated;

comment on function public.ai_supplier_upcoming_dues(integer, uuid, integer) is
  'Open supplier documents due within p_days (overdue included), soonest first, with window totals. Security invoker.';

-- Monthly purchase evolution over [p_from, p_to]. p_group_by:
--   'item'     → per supplier and normalized item description, from invoice
--                items: quantity, net ARS and the quantity-weighted average
--                unit price (requires a supplier, category or item filter);
--   'supplier' → per supplier, from invoice headers (net ARS, documents);
--   'category' → per supplier category, from invoice headers.
-- Credit notes subtract in the header modes; item mode reads invoices only.
create or replace function public.ai_supplier_price_evolution(
  p_from date,
  p_to date,
  p_group_by text default 'supplier',
  p_supplier_id uuid default null,
  p_category_id uuid default null,
  p_item_query text default null,
  p_limit integer default 300
)
returns table(
  period text,
  dim_id text,
  dim_label text,
  item text,
  documents integer,
  quantity numeric,
  net_ars numeric,
  avg_unit_price_ars numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with headers as (
    select
      pi.id,
      pi.fecha,
      pi.supplier_id,
      s.legal_name,
      s.category_id,
      coalesce(sc.name, 'Sin categoría') as category_name,
      pi.kind,
      coalesce(nullif(pi.cotizacion, 0), 1) as rate,
      pi.imp_neto
    from public.purchase_invoices pi
    join public.suppliers s on s.id = pi.supplier_id
    left join public.supplier_categories sc on sc.id = s.category_id
    where pi.status = 'received'
      and pi.fecha between p_from and p_to
      and (p_supplier_id is null or pi.supplier_id = p_supplier_id)
      and (p_category_id is null or s.category_id = p_category_id)
  ),
  rows_out as (
    select
      to_char(h.fecha, 'YYYY-MM') as period,
      h.supplier_id::text as dim_id,
      h.legal_name as dim_label,
      lower(btrim(it.description)) as item,
      count(distinct h.id)::integer as documents,
      sum(it.quantity) as quantity,
      sum(it.line_neto * h.rate) as net_ars,
      sum(it.line_neto * h.rate) / nullif(sum(it.quantity), 0) as avg_unit_price_ars
    from headers h
    join public.purchase_invoice_items it on it.purchase_invoice_id = h.id
    where p_group_by = 'item'
      and h.kind = 'factura'
      and (p_supplier_id is not null or p_category_id is not null or p_item_query is not null)
      and (p_item_query is null or it.description ilike '%' || p_item_query || '%')
    group by 1, 2, 3, 4
    union all
    select
      to_char(h.fecha, 'YYYY-MM'),
      case when p_group_by = 'category' then coalesce(h.category_id::text, 'none') else h.supplier_id::text end,
      case when p_group_by = 'category' then h.category_name else h.legal_name end,
      '',
      count(*)::integer,
      null::numeric,
      sum(case when h.kind = 'nc' then -1 else 1 end * h.imp_neto * h.rate),
      null::numeric
    from headers h
    where p_group_by in ('supplier', 'category')
    group by 1, 2, 3, 4
  )
  select
    rows_out.period,
    rows_out.dim_id,
    rows_out.dim_label,
    rows_out.item,
    rows_out.documents,
    rows_out.quantity,
    round(rows_out.net_ars, 2),
    round(rows_out.avg_unit_price_ars, 2)
  from rows_out
  order by rows_out.dim_label, rows_out.item, rows_out.period
  limit greatest(1, least(p_limit, 1000));
$$;

revoke all on function public.ai_supplier_price_evolution(date, date, text, uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.ai_supplier_price_evolution(date, date, text, uuid, uuid, text, integer) to authenticated;

comment on function public.ai_supplier_price_evolution(date, date, text, uuid, uuid, text, integer) is
  'Monthly purchase evolution per item (avg unit price), supplier or category. Security invoker.';

------------------------------------------------------------------------------
-- 6. AFIP numbering status
------------------------------------------------------------------------------

-- Last number and date AFIP accepted (emitted, or emitted and later
-- cancelled) per sales point × voucher kind × letter, read through the
-- invoices_unique_numbering index (one probe per combination).
create or replace function public.ai_afip_last_numbers()
returns table(
  channel_id text,
  punto_venta integer,
  nickname text,
  is_enabled boolean,
  kind text,
  letter text,
  last_numero integer,
  last_fecha date
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    sp.channel_id,
    sp.numero,
    coalesce(sp.nickname, ''),
    sp.is_enabled,
    k.kind,
    l.letter,
    x.numero,
    x.fecha
  from public.sales_points sp
  cross join (values ('factura'), ('nc'), ('nd')) as k(kind)
  cross join (values ('A'), ('B'), ('C'), ('')) as l(letter)
  cross join lateral (
    select i.numero, i.fecha
    from public.invoices i
    where i.channel_id = sp.channel_id
      and i.punto_venta = sp.numero
      and i.kind = k.kind
      and coalesce(i.letter::text, '') = l.letter
      and i.numero is not null
      and i.status in ('emitted', 'cancelled')
    order by i.numero desc
    limit 1
  ) x
  where sp.channel_id is not null
  order by 2, 5, 6;
$$;

revoke all on function public.ai_afip_last_numbers() from public, anon, authenticated;
grant execute on function public.ai_afip_last_numbers() to authenticated;

comment on function public.ai_afip_last_numbers() is
  'Last emitted voucher number and date per sales point, kind and letter. Security invoker.';

------------------------------------------------------------------------------
-- 7. Warehouse and shipments
------------------------------------------------------------------------------

-- Current pallet position per warehouse and client: pallets in stock
-- (status en_deposito), their units, and pallets entered / exited in the last
-- 30 days.
create or replace function public.ai_pallets_summary()
returns table(
  warehouse_id uuid,
  warehouse_name text,
  client_id uuid,
  client_name text,
  in_stock integer,
  units_in_stock numeric,
  entered_30d integer,
  exited_30d integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.warehouse_id,
    coalesce(w.name, ''),
    p.client_id,
    coalesce(c.legal_name, ''),
    (count(*) filter (where p.status = 'en_deposito'))::integer,
    coalesce(sum(p.quantity) filter (where p.status = 'en_deposito'), 0),
    (count(*) filter (where p.entry_date >= current_date - 30))::integer,
    (count(*) filter (where p.exit_date >= current_date - 30))::integer
  from public.pallets p
  left join public.warehouses w on w.id = p.warehouse_id
  left join public.clients c on c.id = p.client_id
  where p.status = 'en_deposito'
     or p.entry_date >= current_date - 30
     or p.exit_date >= current_date - 30
  group by p.warehouse_id, w.name, p.client_id, c.legal_name
  order by 5 desc, 2, 4;
$$;

revoke all on function public.ai_pallets_summary() from public, anon, authenticated;
grant execute on function public.ai_pallets_summary() to authenticated;

comment on function public.ai_pallets_summary() is
  'Pallets in stock and 30-day movement per warehouse and client. Security invoker.';

-- Shipments per status and client scheduled in [p_from, p_to] (created in the
-- range when unscheduled): count, freight and how many are already invoiced.
create or replace function public.ai_shipments_summary(
  p_from date,
  p_to date
)
returns table(
  status text,
  client_id uuid,
  client_name text,
  shipments integer,
  freight numeric,
  invoiced integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.status,
    s.client_id,
    coalesce(c.legal_name, 'Sin cliente'),
    count(*)::integer,
    coalesce(sum(s.freight_amount), 0),
    (count(*) filter (where s.invoice_id is not null))::integer
  from public.shipments s
  left join public.clients c on c.id = s.client_id
  where s.scheduled_date between p_from and p_to
     or (
       s.scheduled_date is null
       and s.created_at >= p_from::timestamptz
       and s.created_at < (p_to + 1)::timestamptz
     )
  group by s.status, s.client_id, c.legal_name
  order by 1, 5 desc;
$$;

revoke all on function public.ai_shipments_summary(date, date) from public, anon, authenticated;
grant execute on function public.ai_shipments_summary(date, date) to authenticated;

comment on function public.ai_shipments_summary(date, date) is
  'Shipments per status and client in a date range: count, freight and invoiced count. Security invoker.';

------------------------------------------------------------------------------
-- 8. Indexes for the new range filters
------------------------------------------------------------------------------

-- Fleet margin ranges fuel loads and maintenance across every vehicle; the
-- existing indexes lead with vehicle_id.
create index if not exists fuel_loads_load_date_idx
  on public.fuel_loads (load_date);
create index if not exists maintenance_records_service_date_idx
  on public.maintenance_records (service_date);

-- Pallet summary: recent entries and exits next to pallets_status_idx.
create index if not exists pallets_entry_date_idx
  on public.pallets (entry_date);
create index if not exists pallets_exit_date_idx
  on public.pallets (exit_date)
  where exit_date is not null;

-- Shipments summary: scheduled range, or creation range when unscheduled.
create index if not exists shipments_scheduled_date_idx
  on public.shipments (scheduled_date);
create index if not exists shipments_unscheduled_created_idx
  on public.shipments (created_at)
  where scheduled_date is null;

set row_security = on;
