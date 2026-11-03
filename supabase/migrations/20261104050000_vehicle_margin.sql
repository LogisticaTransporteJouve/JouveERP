SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Margen por camión (gestión, uso interno) and ai_fleet_margin without
-- cancelled trips. Expand-only: one nullable column, one new function and a
-- replacement with the same signature and columns.
--
--   1. cost_centers.vehicle_id: the truck a cost center belongs to (at most
--      one center per truck, at most one truck per center). A cost loaded with
--      that center (a purchase, a manual expense, a journal entry: the cost
--      tagging of 20261103010000) is a cost of that truck. Nothing changes on
--      the cost forms.
--   2. ai_fleet_margin (same signature and columns): a cancelled trip no
--      longer counts (its revenue, its cost, its trip), like
--      ai_vehicle_activity and ai_driver_activity. Fuel loads and maintenance
--      still count per vehicle by their own date: the money was spent.
--   3. get_vehicle_margin(from, to): per truck, over whole months, accrual:
--      revenue, trip cost, fuel and maintenance from ai_fleet_margin, plus the
--      operating cost of the truck's cost center from management_pnl_lines.
--      A purchase or movement a fuel load or maintenance record points at
--      (and an NC/ND of such a purchase) is left out of the center part: the
--      fleet side already counts it. What no truck owns comes apart, never
--      spread: trips without a vehicle ('no_vehicle'), the operating cost of
--      each center without a truck ('unlinked_center') and the one without a
--      center ('no_center'). USD without a rate stays in pending_usd.
--
-- Rollback: older code does not read cost_centers.vehicle_id nor call
-- get_vehicle_margin; ai_fleet_margin keeps its columns.

-- 1. Truck of a cost center -----------------------------------------------------------

-- New, all-NULL column: the FK check has nothing to scan.
alter table public.cost_centers
  -- squawk-ignore adding-foreign-key-constraint
  add column vehicle_id uuid references public.vehicles (id) on delete set null;

comment on column public.cost_centers.vehicle_id is
  'Camión del centro de costo: lo cargado con este centro es costo de ese camión en el margen por camión (gestión). Uno por camión.';

-- cost_centers is a short catalog.
-- squawk-ignore require-concurrent-index-creation
create unique index cost_centers_vehicle_unique
  on public.cost_centers (vehicle_id)
  where vehicle_id is not null;

-- 2. Fleet margin without cancelled trips --------------------------------------------

-- Same as 20261031204119 except trips_in (no cancelled trips) and the fuel
-- scope filter, which reads every trip of the scope (a load tied to a
-- cancelled trip still counts for its vehicle).
create or replace function public.ai_fleet_margin(
  p_from date,
  p_to date,
  p_group_by text default 'vehicle',
  p_limit integer default 50,
  p_is_fiscal boolean default null
)
returns table(
  group_key text,
  label text,
  trips integer,
  revenue numeric,
  invoiced_revenue numeric,
  manual_revenue numeric,
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
set search_path = ''
as $$
  with trips_scope as (
    select tr.id, tr.status
    from public.trips tr
    where tr.trip_date between p_from and p_to
      and (p_is_fiscal is null or exists (
        select 1 from public.invoicing_channels c
        where c.id = tr.channel_id and c.is_fiscal = p_is_fiscal
      ))
  ),
  trips_in as (
    select
      tr.id,
      tr.trip_date,
      tr.vehicle_id,
      tr.driver_id,
      tr.origin,
      tr.destination,
      r.revenue::numeric as revenue,
      r.invoiced_revenue::numeric as invoiced_revenue,
      coalesce(r.manual_revenue, 0)::numeric as manual_revenue,
      r.revenue_source,
      coalesce(tr.cost, 0)::numeric as trip_cost
    from public.trips tr
    join trips_scope s on s.id = tr.id
    join public.v_trip_revenue r on r.trip_id = tr.id
    where s.status <> 'cancelled'
  ),
  fuel_in as (
    select fl.vehicle_id, fl.trip_id, fl.amount
    from public.fuel_loads fl
    where fl.load_date between p_from and p_to
      and (p_is_fiscal is null or fl.trip_id in (select trips_scope.id from trips_scope))
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
      case when s.invoice_id is not null then coalesce(s.freight_amount, 0) else 0 end::numeric as invoiced,
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
      tr.invoiced_revenue as inv,
      tr.manual_revenue as man,
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
      sum(tr.invoiced_revenue),
      sum(tr.manual_revenue),
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
      coalesce(tv.invoiced_revenue, 0),
      coalesce(tv.manual_revenue, 0),
      coalesce(tv.trip_cost, 0),
      coalesce(vf.amount, 0),
      coalesce(mt.cost, 0)
    from public.vehicles v
    left join (
      select
        trip_rows.vehicle_id,
        count(*) as n,
        sum(trip_rows.revenue) as revenue,
        sum(trip_rows.invoiced_revenue) as invoiced_revenue,
        sum(trip_rows.manual_revenue) as manual_revenue,
        sum(trip_rows.trip_cost) as trip_cost
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
        and p_is_fiscal is null
      group by m.vehicle_id
    ) mt on mt.vehicle_id = v.id
    where p_group_by = 'vehicle'
      and (tv.vehicle_id is not null or vf.vehicle_id is not null or mt.vehicle_id is not null)
    union all
    select
      coalesce(a.client_id::text, 'none'),
      coalesce(c.legal_name, 'Sin cliente asignado'),
      count(distinct a.id)::integer,
      sum(case when a.revenue_source = 'invoiced' then a.invoiced else a.revenue * a.share end),
      sum(a.invoiced),
      sum(a.manual_revenue * a.share),
      sum(a.trip_cost * a.share),
      sum(a.fuel_cost * a.share),
      0::numeric
    from (
      select
        tr.id,
        tr.revenue,
        tr.revenue_source,
        tr.manual_revenue,
        tr.trip_cost,
        tr.fuel_cost,
        sh.client_id,
        coalesce(sh.invoiced, 0) as invoiced,
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
    round(g.inv, 2),
    round(g.man, 2),
    round(g.tcost, 2),
    round(g.fcost, 2),
    round(g.mcost, 2),
    round(g.rev - g.tcost - g.fcost - g.mcost, 2),
    case when g.rev <> 0 then round((g.rev - g.tcost - g.fcost - g.mcost) / g.rev * 100, 1) end,
    (count(*) over ())::integer,
    round(sum(g.rev) over (), 2),
    round(sum(g.rev - g.tcost - g.fcost - g.mcost) over (), 2)
  from grouped g
  order by 10 desc, 2
  limit greatest(1, least(p_limit, 500));
$$;

comment on function public.ai_fleet_margin(date, date, text, integer, boolean) is
  'Margen de flota por viaje, chofer, vehículo o cliente en un rango: ingreso (v_trip_revenue), costo de viaje, combustible y mantenimiento. Sin viajes cancelados; el combustible y el mantenimiento cuentan por vehículo por su fecha. SECURITY INVOKER.';

revoke all on function public.ai_fleet_margin(date, date, text, integer, boolean) from public, anon;
grant execute on function public.ai_fleet_margin(date, date, text, integer, boolean) to authenticated, service_role;

-- 3. Margin per truck ------------------------------------------------------------------

create function public.get_vehicle_margin(
  p_from date,
  p_to   date
)
returns table (
  row_kind         text,
  vehicle_id       uuid,
  patente          text,
  is_active        boolean,
  cost_center_id   uuid,
  trips            integer,
  revenue          numeric,
  trip_cost        numeric,
  fuel_cost        numeric,
  maintenance_cost numeric,
  center_cost      numeric,
  net              numeric,
  pending_usd      numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from   date;
  v_to     date;
  v_groups integer;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para ver el resultado de gestión'
      using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Período inválido'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  -- Whole months, like the management lines the center part reads.
  v_from := date_trunc('month', p_from)::date;
  v_to := (date_trunc('month', p_to) + interval '1 month - 1 day')::date;

  -- ai_fleet_margin returns at most 500 groups: fail instead of dropping
  -- trucks.
  select coalesce(max(f.total_groups), 0) into v_groups
    from public.ai_fleet_margin(v_from, v_to, 'vehicle', 1, null) f;
  if v_groups > 500 then
    raise exception 'Hay más de 500 vehículos con movimientos en el período: acotá el rango'
      using errcode = '54000', hint = 'jouve_guard';
  end if;

  return query
  with fleet as materialized (
    select f.group_key, f.trips, f.revenue, f.trip_cost, f.fuel_cost, f.maintenance_cost
      from public.ai_fleet_margin(v_from, v_to, 'vehicle', 500, null) f
  ),
  -- Documents the fleet side already counts (a fuel load's or a service's
  -- purchase or movement) and the NC/ND of such a purchase.
  linked as (
    select 'purchase_invoices'::text as src, f.purchase_invoice_id as id
      from public.fuel_loads f where f.purchase_invoice_id is not null
    union
    select 'transactions', f.transaction_id
      from public.fuel_loads f where f.transaction_id is not null
    union
    select 'purchase_invoices', m.purchase_invoice_id
      from public.maintenance_records m where m.purchase_invoice_id is not null
    union
    select 'transactions', m.transaction_id
      from public.maintenance_records m where m.transaction_id is not null
  ),
  linked_all as (
    select k.src, k.id from linked k
    union
    select 'purchase_invoices', p.id
      from public.purchase_invoices p
      join linked k on k.src = 'purchase_invoices' and k.id = p.invoice_origin_id
  ),
  lines as materialized (
    select l.cost_center_id, l.bucket, l.amount_ars, l.pending_usd
      from public.management_pnl_lines(v_from, v_to, 'accrual') l
     where l.bucket in ('operating_cost', 'pending_usd')
       and not exists (
         select 1 from linked_all k where k.src = l.source_table and k.id = l.source_id
       )
  ),
  centers as (
    select l.cost_center_id,
           coalesce(-sum(l.amount_ars) filter (where l.bucket = 'operating_cost'), 0) as cost,
           coalesce(sum(l.pending_usd), 0) as pending
      from lines l
     group by l.cost_center_id
  ),
  per_vehicle as (
    select v.id, v.patente, v.is_active, cc.id as center_id,
           coalesce(f.trips, 0) as n,
           coalesce(f.revenue, 0) as rev,
           coalesce(f.trip_cost, 0) as tcost,
           coalesce(f.fuel_cost, 0) as fcost,
           coalesce(f.maintenance_cost, 0) as mcost,
           coalesce(c.cost, 0) as ccost,
           coalesce(c.pending, 0) as pending
      from public.vehicles v
      left join public.cost_centers cc on cc.vehicle_id = v.id
      left join fleet f on f.group_key = v.id::text
      left join centers c on c.cost_center_id = cc.id
     where f.group_key is not null or c.cost_center_id is not null
  ),
  no_vehicle as (
    select count(*)::integer as n,
           coalesce(sum(r.revenue), 0) as rev,
           coalesce(sum(coalesce(t.cost, 0)), 0) as tcost
      from public.trips t
      join public.v_trip_revenue r on r.trip_id = t.id
     where t.vehicle_id is null
       and t.status <> 'cancelled'
       and t.trip_date between v_from and v_to
  )
  select 'vehicle'::text, pv.id, pv.patente, pv.is_active, pv.center_id, pv.n,
         round(pv.rev, 2), round(pv.tcost, 2), round(pv.fcost, 2), round(pv.mcost, 2),
         round(pv.ccost, 2),
         round(pv.rev - pv.tcost - pv.fcost - pv.mcost - pv.ccost, 2),
         round(pv.pending, 2)
    from per_vehicle pv
  union all
  select 'no_vehicle', null, null, null, null, nv.n,
         round(nv.rev, 2), round(nv.tcost, 2), 0::numeric, 0::numeric, 0::numeric,
         round(nv.rev - nv.tcost, 2), 0::numeric
    from no_vehicle nv
   where nv.n > 0
  union all
  select case when c.cost_center_id is null then 'no_center' else 'unlinked_center' end,
         null, null, null, c.cost_center_id, 0,
         0::numeric, 0::numeric, 0::numeric, 0::numeric,
         round(c.cost, 2), round(-c.cost, 2), round(c.pending, 2)
    from centers c
   where not exists (
     select 1 from public.cost_centers cc
      where cc.id = c.cost_center_id and cc.vehicle_id is not null
   )
     and (c.cost <> 0 or c.pending <> 0);
end;
$$;

comment on function public.get_vehicle_margin(date, date) is
  'Margen por camión (gestión, uso interno, devengado, meses completos): ingreso, viajes, combustible y mantenimiento (ai_fleet_margin) más el costo operativo del centro de costo del camión (cost_centers.vehicle_id), sin contar dos veces lo que una carga de combustible o un service ya imputa. Lo que no es de un camión va aparte (no_vehicle, unlinked_center, no_center).';

revoke all on function public.get_vehicle_margin(date, date) from public, anon, authenticated;
grant execute on function public.get_vehicle_margin(date, date) to service_role;
