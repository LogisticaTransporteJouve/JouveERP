SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W10 · S6 F2 / S3 F3 / S3 F4: fleet figures that read as final
-- when they are not.
--
-- 1. v_trip_revenue gains uninvoiced_shipments: how many non-cancelled cargas
--    of the trip are still to invoice. A carga priced by the client's tariff
--    has no freight_amount until its liquidación is invoiced, so
--    uninvoiced_freight (a sum) reads 0 for it; "pending" is now decided by
--    this count. Appended at the end, so older readers are unaffected.
-- 2. ai_fleet_margin:
--    - uninvoiced_shipments per group and total_uninvoiced_shipments.
--    - By vehicle, the trips without a vehicle are one more group, 'none'
--      («Sin vehículo», as the driver and client groupings already do), so
--      every trip counts in the window totals by vehicle, as by trip (the
--      net by vehicle also takes the fuel without a trip and the
--      maintenance). Its fuel is 0: every fuel load has a vehicle and counts
--      there.
--    - maintenance_without_cost per group and in total: a service with no
--      cost is unknown, not $0 (#396), and is now counted.
--    Same body as 20261104160201 (its latest definition) plus that. New OUT
--    columns need a drop; nothing depends on the function (get_vehicle_margin
--    is plpgsql and reads it by column name).
-- 3. get_vehicle_margin gains maintenance_without_cost per truck and skips
--    the new 'none' group (it reads the trips without a vehicle on its own).
--    Its 500-group check now counts 'none' too, so it refuses one truck
--    earlier rather than let 'none' push a truck off the page. Same body as
--    20261104150201 (its latest definition) plus that. A new OUT column
--    needs a drop.
--
-- Rollback: older code reads the view and both functions by column name and
-- ignores the new columns. Older code reading ai_fleet_margin by vehicle sees
-- one more row, 'none': getVehicleEconomics would list it as a vehicle
-- labelled «Sin vehículo» (its totals were already reported apart), the other
-- readers key by vehicle id and skip it.

------------------------------------------------------------------------------
-- 1. v_trip_revenue
------------------------------------------------------------------------------

-- Same as 20261031204119 plus uninvoiced_shipments, appended. The options
-- are restated: create or replace view replaces them.
create or replace view public.v_trip_revenue
with (security_invoker = on) as
  select
    t.id         as trip_id,
    t.trip_date,
    t.revenue    as manual_revenue,
    coalesce(s.shipments, 0)::integer as shipments,
    coalesce(s.invoiced, 0)::numeric(14, 2) as invoiced_revenue,
    coalesce(s.uninvoiced, 0)::numeric(14, 2) as uninvoiced_freight,
    (case
       when coalesce(s.shipments, 0) > 0 then coalesce(s.invoiced, 0)
       else coalesce(t.revenue, 0)
     end)::numeric(14, 2) as revenue,
    case when coalesce(s.shipments, 0) > 0 then 'invoiced' else 'manual' end as revenue_source,
    coalesce(s.uninvoiced_shipments, 0)::integer as uninvoiced_shipments
  from public.trips t
  left join lateral (
    select
      count(*) as shipments,
      sum(coalesce(sh.freight_amount, 0)) filter (where sh.invoice_id is not null) as invoiced,
      sum(coalesce(sh.freight_amount, 0)) filter (where sh.invoice_id is null) as uninvoiced,
      count(*) filter (where sh.invoice_id is null) as uninvoiced_shipments
    from public.shipments sh
    where sh.trip_id = t.id
      and sh.status <> 'cancelled'
  ) s on true;

comment on view public.v_trip_revenue is
  'Ingreso de cada viaje para rentabilidad: flete de sus cargas facturadas (no canceladas); sin cargas, el ingreso manual trips.revenue. uninvoiced_freight y uninvoiced_shipments: flete y cantidad de sus cargas sin facturar (una carga por tarifa no tiene flete hasta facturarse: la cantidad dice si está pendiente). SECURITY INVOKER.';

revoke all on table public.v_trip_revenue from public, anon, authenticated;
grant select on table public.v_trip_revenue to authenticated;

------------------------------------------------------------------------------
-- 2. ai_fleet_margin
------------------------------------------------------------------------------

-- Recreated below in the same transaction with the same arguments.
-- squawk-ignore ban-drop-function
drop function public.ai_fleet_margin(date, date, text, integer, boolean);

-- Same as 20261104160201 plus uninvoiced_shipments, maintenance_without_cost
-- (each group and the final select) and the 'none' vehicle group.
create function public.ai_fleet_margin(
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
  total_net numeric,
  uninvoiced_freight numeric,
  total_uninvoiced_freight numeric,
  uninvoiced_shipments integer,
  total_uninvoiced_shipments integer,
  maintenance_without_cost integer,
  total_maintenance_without_cost integer
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
      r.uninvoiced_freight::numeric as uninvoiced_freight,
      r.uninvoiced_shipments::integer as uninvoiced_shipments,
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
      case when s.invoice_id is null then coalesce(s.freight_amount, 0) else 0 end::numeric as uninvoiced,
      case when s.invoice_id is null then 1 else 0 end as uninvoiced_n,
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
      0::numeric as mcost,
      tr.uninvoiced_freight as unv,
      tr.uninvoiced_shipments::bigint as unc,
      0::bigint as mnc
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
      0::numeric,
      sum(tr.uninvoiced_freight),
      sum(tr.uninvoiced_shipments)::bigint,
      0::bigint
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
      coalesce(mt.cost, 0),
      coalesce(tv.uninvoiced_freight, 0),
      coalesce(tv.uninvoiced_shipments, 0)::bigint,
      coalesce(mt.without_cost, 0)::bigint
    from public.vehicles v
    left join (
      select
        trip_rows.vehicle_id,
        count(*) as n,
        sum(trip_rows.revenue) as revenue,
        sum(trip_rows.invoiced_revenue) as invoiced_revenue,
        sum(trip_rows.manual_revenue) as manual_revenue,
        sum(trip_rows.trip_cost) as trip_cost,
        sum(trip_rows.uninvoiced_freight) as uninvoiced_freight,
        sum(trip_rows.uninvoiced_shipments) as uninvoiced_shipments
      from trip_rows
      group by trip_rows.vehicle_id
    ) tv on tv.vehicle_id = v.id
    left join (
      select fuel_in.vehicle_id, sum(fuel_in.amount) as amount
      from fuel_in
      group by fuel_in.vehicle_id
    ) vf on vf.vehicle_id = v.id
    left join (
      select m.vehicle_id,
             sum(coalesce(m.cost, 0)) as cost,
             count(*) filter (where m.cost is null) as without_cost
      from public.maintenance_records m
      where m.service_date between p_from and p_to
        and p_is_fiscal is null
      group by m.vehicle_id
    ) mt on mt.vehicle_id = v.id
    where p_group_by = 'vehicle'
      and (tv.vehicle_id is not null or vf.vehicle_id is not null or mt.vehicle_id is not null)
    union all
    -- Trips without a vehicle: their revenue and cost; their fuel loads
    -- count in the loads' vehicle.
    select
      'none',
      'Sin vehículo',
      count(*)::integer,
      sum(tr.revenue),
      sum(tr.invoiced_revenue),
      sum(tr.manual_revenue),
      sum(tr.trip_cost),
      0::numeric,
      0::numeric,
      sum(tr.uninvoiced_freight),
      sum(tr.uninvoiced_shipments)::bigint,
      0::bigint
    from trip_rows tr
    where p_group_by = 'vehicle'
      and tr.vehicle_id is null
    having count(*) > 0
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
      0::numeric,
      sum(a.uninvoiced),
      sum(a.uninvoiced_n)::bigint,
      0::bigint
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
        coalesce(sh.uninvoiced, 0) as uninvoiced,
        coalesce(sh.uninvoiced_n, 0) as uninvoiced_n,
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
    round(sum(g.rev - g.tcost - g.fcost - g.mcost) over (), 2),
    round(g.unv, 2),
    round(sum(g.unv) over (), 2),
    g.unc::integer,
    (sum(g.unc) over ())::integer,
    g.mnc::integer,
    (sum(g.mnc) over ())::integer
  from grouped g
  order by 10 desc, 2
  limit greatest(1, least(p_limit, 500));
$$;

comment on function public.ai_fleet_margin(date, date, text, integer, boolean) is
  'Margen de flota por viaje, chofer, vehículo o cliente en un rango: ingreso (v_trip_revenue), costo de viaje, combustible y mantenimiento. Sin viajes cancelados; el combustible y el mantenimiento cuentan por vehículo por su fecha; por vehículo, los viajes sin vehículo son el grupo none. uninvoiced_freight y uninvoiced_shipments: flete y cantidad de las cargas sin facturar (no canceladas), fuera del ingreso (el neto de ese grupo no es definitivo). maintenance_without_cost: services sin costo cargado (no están en el mantenimiento). SECURITY INVOKER.';

revoke all on function public.ai_fleet_margin(date, date, text, integer, boolean) from public, anon;
grant execute on function public.ai_fleet_margin(date, date, text, integer, boolean) to authenticated, service_role;

------------------------------------------------------------------------------
-- 3. get_vehicle_margin
------------------------------------------------------------------------------

-- Recreated below in the same transaction with the same arguments.
-- squawk-ignore ban-drop-function
drop function public.get_vehicle_margin(date, date);

-- Same as 20261104150201 plus maintenance_without_cost, without the 'none'
-- group.
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
  pending_usd      numeric,
  maintenance_without_cost integer
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
  -- trucks. The count includes its 'none' group, which shares the page.
  select coalesce(max(f.total_groups), 0) into v_groups
    from public.ai_fleet_margin(v_from, v_to, 'vehicle', 1, null) f;
  if v_groups > 500 then
    raise exception 'Hay más de 500 vehículos con movimientos en el período: acotá el rango'
      using errcode = '54000', hint = 'jouve_guard';
  end if;

  return query
  with fleet as materialized (
    select f.group_key, f.trips, f.revenue, f.trip_cost, f.fuel_cost, f.maintenance_cost,
           f.maintenance_without_cost
      from public.ai_fleet_margin(v_from, v_to, 'vehicle', 500, null) f
     where f.group_key <> 'none'
  ),
  -- Documents the fleet side already counts: a fuel load's or a service's
  -- purchase or movement. An NC/ND of such a purchase is not one (the load's
  -- amount and the service's cost do not change with it), so it counts in
  -- its center, as in Gestión.
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
  lines as materialized (
    select l.cost_center_id, l.bucket, l.amount_ars, l.pending_usd
      from public.management_pnl_lines(v_from, v_to, 'accrual') l
     where l.bucket in ('operating_cost', 'unclassified', 'pending_usd')
       and not exists (
         select 1 from linked k where k.src = l.source_table and k.id = l.source_id
       )
  ),
  centers as (
    select l.cost_center_id,
           coalesce(-sum(l.amount_ars) filter (where l.bucket in ('operating_cost', 'unclassified')), 0) as cost,
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
           coalesce(f.maintenance_without_cost, 0) as mnc,
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
         round(pv.pending, 2),
         pv.mnc::integer
    from per_vehicle pv
  union all
  select 'no_vehicle', null, null, null, null, nv.n,
         round(nv.rev, 2), round(nv.tcost, 2), 0::numeric, 0::numeric, 0::numeric,
         round(nv.rev - nv.tcost, 2), 0::numeric, 0
    from no_vehicle nv
   where nv.n > 0
  union all
  select case when c.cost_center_id is null then 'no_center' else 'unlinked_center' end,
         null, null, null, c.cost_center_id, 0,
         0::numeric, 0::numeric, 0::numeric, 0::numeric,
         round(c.cost, 2), round(-c.cost, 2), round(c.pending, 2), 0
    from centers c
   where not exists (
     select 1 from public.cost_centers cc
      where cc.id = c.cost_center_id and cc.vehicle_id is not null
   )
     and (c.cost <> 0 or c.pending <> 0);
end;
$$;

comment on function public.get_vehicle_margin(date, date) is
  'Margen por camión (gestión, uso interno, devengado, meses completos): ingreso, viajes, combustible y mantenimiento (ai_fleet_margin) más el costo operativo y lo sin clasificar del centro de costo del camión (cost_centers.vehicle_id), sin contar dos veces la compra o el movimiento que una carga de combustible o un service ya imputa (la NC/ND de esa compra sí cuenta, en su centro). maintenance_without_cost: services del camión sin costo cargado (no están en el mantenimiento). Lo que no es de un camión va aparte (no_vehicle, unlinked_center, no_center).';

revoke all on function public.get_vehicle_margin(date, date) from public, anon, authenticated;
grant execute on function public.get_vehicle_margin(date, date) to service_role;
