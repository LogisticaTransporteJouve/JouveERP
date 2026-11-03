SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Roadmap 6.1 (consultas cruzadas): three read aggregates the AI CFO
-- composes with the existing ones (ai_fleet_margin, ai_client_sales_summary,
-- get_management_pnl) to answer cross-domain questions. Expand-only: three
-- new functions, nothing else changes.
--
--   1. ai_client_net_revenue: net revenue per client (neto + no gravado +
--      exento, without IVA or tributos), facturas and ND minus NC. Pesos as
--      they are; a foreign-currency comprobante at its own cotización, or the
--      official rate of its date (get_exchange_rate) when it has none — the
--      journal's convention. With neither it is NOT converted: it comes apart
--      as pending_foreign, never at 1:1.
--   2. ai_vehicle_activity: per vehicle, trips (not cancelled), trip km and
--      trips without km; fuel loads and liters (p_include_fuel); odometer km
--      from the monthly readings (p_include_km): the reading of the range's
--      last month minus the one of the month before the first. A row with a
--      NULL vehicle carries the trips without a vehicle and, with
--      p_include_revenue, their revenue (v_trip_revenue).
--   3. ai_driver_activity: per driver, trips (not cancelled), km and trips
--      without km; with p_include_hr, the linked employee's payroll extras of
--      the range's months, advances in the range by currency and the current
--      employee account balance in pesos. A row with a NULL driver carries
--      the trips without a driver.
--
-- All three are SECURITY INVOKER: RLS applies exactly as on the tables they
-- read (a driver sees only their trips, the HR tables stay owner/admin/
-- finance). The include flags let the server action leave out what the
-- user's per-user denies hide, so a denied part is NULL instead of 0.

------------------------------------------------------------------------------
-- 1. Net revenue per client
------------------------------------------------------------------------------

create function public.ai_client_net_revenue(
  p_from date,
  p_to date,
  p_is_fiscal boolean default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  client_id uuid,
  legal_name text,
  net_revenue_ars numeric,
  invoices integer,
  credit_notes integer,
  debit_notes integer,
  pending_foreign numeric,
  total_clients integer,
  total_net_revenue_ars numeric,
  total_pending_foreign numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with docs as (
    select
      i.client_id,
      i.kind,
      (case when i.kind = 'nc' then -1 else 1 end)
        * (coalesce(i.imp_neto, 0) + coalesce(i.imp_op_ex, 0) + coalesce(i.imp_tot_conc, 0)) as net,
      case
        when i.moneda is null or i.moneda = 'PES' then 1::numeric
        else coalesce(nullif(i.cotizacion, 0), public.get_exchange_rate('USD', i.fecha))
      end as fx
    from public.invoices i
    where i.status = 'emitted'
      and i.fecha between p_from and p_to
      and (p_is_fiscal is null or exists (
        select 1 from public.invoicing_channels c
        where c.id = i.channel_id and c.is_fiscal = p_is_fiscal
      ))
  ),
  per_client as (
    select
      docs.client_id,
      coalesce(sum(docs.net * docs.fx) filter (where docs.fx is not null), 0) as net_ars,
      coalesce(sum(docs.net) filter (where docs.fx is null), 0) as pending,
      count(*) filter (where docs.kind = 'factura') as invoices,
      count(*) filter (where docs.kind = 'nc') as credit_notes,
      count(*) filter (where docs.kind = 'nd') as debit_notes
    from docs
    group by docs.client_id
  )
  select
    p.client_id,
    c.legal_name,
    round(p.net_ars, 2),
    p.invoices::integer,
    p.credit_notes::integer,
    p.debit_notes::integer,
    round(p.pending, 2),
    (count(*) over ())::integer,
    round(sum(p.net_ars) over (), 2),
    round(sum(p.pending) over (), 2)
  from per_client p
  join public.clients c on c.id = p.client_id
  order by 3 desc, 2, 1
  limit greatest(1, least(p_limit, 500))
  offset greatest(p_offset, 0);
$$;

comment on function public.ai_client_net_revenue(date, date, boolean, integer, integer) is
  'Ingreso neto (sin IVA ni tributos) por cliente en un rango: facturas y ND menos NC emitidas, a la cotización del comprobante o la oficial de su fecha; lo que no tiene cotización va aparte (pending_foreign). SECURITY INVOKER.';

revoke all on function public.ai_client_net_revenue(date, date, boolean, integer, integer) from public, anon;
grant execute on function public.ai_client_net_revenue(date, date, boolean, integer, integer) to authenticated, service_role;

------------------------------------------------------------------------------
-- 2. Activity per vehicle
------------------------------------------------------------------------------

create function public.ai_vehicle_activity(
  p_from date,
  p_to date,
  p_include_fuel boolean default false,
  p_include_km boolean default false,
  p_include_revenue boolean default false
)
returns table(
  vehicle_id uuid,
  patente text,
  is_active boolean,
  trips integer,
  trip_km numeric,
  trips_without_km integer,
  unassigned_revenue numeric,
  fuel_loads integer,
  fuel_liters numeric,
  odometer_start numeric,
  odometer_end numeric,
  odometer_km numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      to_char(date_trunc('month', p_from) - interval '1 month', 'YYYY-MM') as start_period,
      to_char(p_to, 'YYYY-MM') as end_period
  ),
  trips_in as (
    select t.id, t.vehicle_id, t.km
    from public.trips t
    where t.trip_date between p_from and p_to
      and t.status <> 'cancelled'
  ),
  tv as (
    select
      trips_in.vehicle_id,
      count(*)::integer as n,
      coalesce(sum(trips_in.km), 0) as km,
      (count(*) filter (where trips_in.km is null))::integer as no_km
    from trips_in
    group by trips_in.vehicle_id
  ),
  fl as (
    select f.vehicle_id, count(*)::integer as n, sum(f.liters) as liters
    from public.fuel_loads f
    where p_include_fuel
      and f.load_date between p_from and p_to
    group by f.vehicle_id
  ),
  km as (
    select
      r.vehicle_id,
      max(r.km) filter (where r.period = b.start_period) as start_km,
      max(r.km) filter (where r.period = b.end_period) as end_km
    from public.vehicle_km_readings r
    cross join bounds b
    where p_include_km
      and r.period in (b.start_period, b.end_period)
    group by r.vehicle_id
  ),
  rows_out as (
    select
      v.id as vehicle_id,
      v.patente,
      v.is_active,
      coalesce(tv.n, 0) as trips,
      coalesce(tv.km, 0) as trip_km,
      coalesce(tv.no_km, 0) as trips_without_km,
      null::numeric as unassigned_revenue,
      case when p_include_fuel then coalesce(fl.n, 0) end as fuel_loads,
      case when p_include_fuel then coalesce(fl.liters, 0) end as fuel_liters,
      km.start_km as odometer_start,
      km.end_km as odometer_end,
      km.end_km - km.start_km as odometer_km
    from public.vehicles v
    left join tv on tv.vehicle_id = v.id
    left join fl on fl.vehicle_id = v.id
    left join km on km.vehicle_id = v.id
    where v.is_active
       or tv.vehicle_id is not null
       or fl.vehicle_id is not null
    union all
    select
      null::uuid,
      null::text,
      null::boolean,
      tv.n,
      tv.km,
      tv.no_km,
      case when p_include_revenue then (
        select coalesce(sum(r.revenue), 0)
        from public.v_trip_revenue r
        join trips_in t on t.id = r.trip_id
        where t.vehicle_id is null
      ) end,
      null::integer,
      null::numeric,
      null::numeric,
      null::numeric,
      null::numeric
    from tv
    where tv.vehicle_id is null
  )
  select
    o.vehicle_id,
    o.patente,
    o.is_active,
    o.trips,
    o.trip_km,
    o.trips_without_km,
    round(o.unassigned_revenue, 2),
    o.fuel_loads,
    o.fuel_liters,
    o.odometer_start,
    o.odometer_end,
    o.odometer_km
  from rows_out o
  order by (o.vehicle_id is null) desc, o.trips desc, o.patente
  limit 501;
$$;

comment on function public.ai_vehicle_activity(date, date, boolean, boolean, boolean) is
  'Actividad por vehículo en un rango: viajes no cancelados, km de viajes, cargas y litros de combustible, km de odómetro (lectura del último mes menos la del mes anterior al primero). Fila sin vehículo = viajes sin vehículo. SECURITY INVOKER.';

revoke all on function public.ai_vehicle_activity(date, date, boolean, boolean, boolean) from public, anon;
grant execute on function public.ai_vehicle_activity(date, date, boolean, boolean, boolean) to authenticated, service_role;

------------------------------------------------------------------------------
-- 3. Activity per driver
------------------------------------------------------------------------------

create function public.ai_driver_activity(
  p_from date,
  p_to date,
  p_include_hr boolean default false
)
returns table(
  driver_id uuid,
  full_name text,
  is_active boolean,
  employee_id uuid,
  trips integer,
  trip_km numeric,
  trips_without_km integer,
  extras_ars numeric,
  advances_ars numeric,
  advances_usd numeric,
  account_balance_ars numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with trips_in as (
    select t.driver_id, t.km
    from public.trips t
    where t.trip_date between p_from and p_to
      and t.status <> 'cancelled'
  ),
  td as (
    select
      trips_in.driver_id,
      count(*)::integer as n,
      coalesce(sum(trips_in.km), 0) as km,
      (count(*) filter (where trips_in.km is null))::integer as no_km
    from trips_in
    group by trips_in.driver_id
  ),
  ex as (
    select r.employee_id, sum(coalesce(r.extras_total, 0)) as extras
    from public.payroll_periods pp
    join public.v_payroll_entries_resolved r on r.period_id = pp.id
    where p_include_hr
      and make_date(pp.year, pp.month, 1) between date_trunc('month', p_from)::date and p_to
    group by r.employee_id
  ),
  adv as (
    select
      m.employee_id,
      sum(m.amount) filter (where m.currency = 'ARS') as ars,
      sum(m.amount) filter (where m.currency = 'USD') as usd
    from public.employee_account_movements m
    where p_include_hr
      and m.kind = 'advance'
      and m.movement_date between p_from and p_to
    group by m.employee_id
  ),
  bal as (
    select b.employee_id, b.balance
    from public.v_employee_account_balances b
    where p_include_hr
      and b.currency = 'ARS'
  ),
  rows_out as (
    select
      d.id as driver_id,
      d.full_name,
      d.is_active,
      d.employee_id,
      coalesce(td.n, 0) as trips,
      coalesce(td.km, 0) as trip_km,
      coalesce(td.no_km, 0) as trips_without_km,
      case when p_include_hr and d.employee_id is not null then coalesce(ex.extras, 0) end as extras_ars,
      case when p_include_hr and d.employee_id is not null then coalesce(adv.ars, 0) end as advances_ars,
      case when p_include_hr and d.employee_id is not null then coalesce(adv.usd, 0) end as advances_usd,
      case when p_include_hr and d.employee_id is not null then coalesce(bal.balance, 0) end as account_balance_ars
    from public.drivers d
    left join td on td.driver_id = d.id
    left join ex on ex.employee_id = d.employee_id
    left join adv on adv.employee_id = d.employee_id
    left join bal on bal.employee_id = d.employee_id
    where d.is_active
       or td.driver_id is not null
    union all
    select
      null::uuid,
      null::text,
      null::boolean,
      null::uuid,
      td.n,
      td.km,
      td.no_km,
      null::numeric,
      null::numeric,
      null::numeric,
      null::numeric
    from td
    where td.driver_id is null
  )
  select
    o.driver_id,
    o.full_name,
    o.is_active,
    o.employee_id,
    o.trips,
    o.trip_km,
    o.trips_without_km,
    round(o.extras_ars, 2),
    round(o.advances_ars, 2),
    round(o.advances_usd, 2),
    round(o.account_balance_ars, 2)
  from rows_out o
  order by (o.driver_id is null) desc, o.trips desc, o.full_name
  limit 501;
$$;

comment on function public.ai_driver_activity(date, date, boolean) is
  'Actividad por chofer en un rango: viajes no cancelados, km y viajes sin km; con p_include_hr, extras de planilla de los meses del rango, adelantos del rango por moneda y saldo actual de la cuenta del empleado en pesos. Fila sin chofer = viajes sin chofer. SECURITY INVOKER.';

revoke all on function public.ai_driver_activity(date, date, boolean) from public, anon;
grant execute on function public.ai_driver_activity(date, date, boolean) to authenticated, service_role;
