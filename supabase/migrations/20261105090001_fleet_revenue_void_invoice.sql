SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W13 · S3 F1 / S1 F1 / S6 F4: a carga whose invoice no longer
-- bills it is not invoiced revenue in the fleet figures.
--
-- Since 20261104194000 a carga whose invoice is void (billing_invoice_is_void:
-- failed, cancelled, or a fiscal factura its emitted NCs credit in full) is
-- no longer billed: the cargas list offers «Facturar flete» again, the guard
-- lets it be edited, and the next «Facturar flete» drops the link. Until that
-- click shipments.invoice_id still points at the invoice, and the fleet
-- readers tested only invoice_id is not null, so the carga's whole flete
-- counted as invoiced revenue and the trip read final
-- (uninvoiced_shipments 0). Now a carga is billed when it is linked to an
-- invoice that is not void, in:
-- 1. v_trip_revenue: invoiced_revenue, revenue, uninvoiced_freight and
--    uninvoiced_shipments. Its readers follow: «Rentabilidad de flota»,
--    get_vehicle_margin (through ai_fleet_margin and its no_vehicle row),
--    ai_vehicle_activity, the AI fleet tools and the fleet insights.
-- 2. ai_fleet_margin's ship CTE (the by-client split: invoiced, uninvoiced,
--    the pending count and the unpriced cargas of a shared trip).
-- 3. ai_shipments_summary's invoiced count (the cargas summary and the AI
--    tool), so the cargas still to invoice are counted the same way.
--
-- The rule is read through shipment_invoice_is_void, security definer: the
-- views and functions above are invoker, and operations (who reads cargas,
-- trips and «Rentabilidad de flota») cannot read invoices, so
-- billing_invoice_is_void would answer null for it and the same carga would
-- read billed for operations and not billed for owner. The helper answers
-- only for a carga, only to the roles that read cargas (the shipments select
-- policy: owner, admin, operations) and the service role, and only yes or
-- no. An unknown answer (null) keeps the carga billed, as before.
--
-- Same columns, signatures and grants: create or replace. Bodies as their
-- latest definitions (v_trip_revenue 20261104170201, ai_fleet_margin
-- 20261104194201, ai_shipments_summary 20261016090000) apart from that test.
--
-- Existing rows are not touched: only what the readers count changes. A
-- carga linked to a factura credited in full now reads as still to invoice,
-- which is what the cargas list already shows.
--
-- Rollback: older code reads the same columns by name; it gets the new
-- figures (a credited carga out of the revenue, counted as pending). The
-- helper is not read by it.

------------------------------------------------------------------------------
-- 1. The rule, for a carga
------------------------------------------------------------------------------

-- Null when the carga has no invoice, does not exist, or the caller does not
-- read cargas.
create function public.shipment_invoice_is_void(p_shipment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.billing_invoice_is_void(s.invoice_id)
    from public.shipments s
   where s.id = p_shipment_id
     and s.invoice_id is not null
     and (coalesce(auth.jwt() ->> 'role', '') = 'service_role'
          or public.user_has_role(array['owner', 'admin', 'operations']));
$$;

comment on function public.shipment_invoice_is_void(uuid) is
  'La factura de la carga ya no la factura (billing_invoice_is_void), para quien lee cargas (owner, admin, operations) o el service role, aunque no lea facturas. Null si la carga no tiene factura. SECURITY DEFINER.';

revoke all on function public.shipment_invoice_is_void(uuid) from public, anon, authenticated;
-- The fleet views and functions run as the signed-in user (invoker).
grant execute on function public.shipment_invoice_is_void(uuid) to authenticated, service_role;

------------------------------------------------------------------------------
-- 2. v_trip_revenue
------------------------------------------------------------------------------

-- Same as 20261104170201 with billed in place of invoice_id is not null. The
-- options are restated: create or replace view replaces them.
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
      sum(coalesce(b.freight_amount, 0)) filter (where b.billed) as invoiced,
      sum(coalesce(b.freight_amount, 0)) filter (where not b.billed) as uninvoiced,
      count(*) filter (where not b.billed) as uninvoiced_shipments
    from (
      select
        sh.freight_amount,
        case
          when sh.invoice_id is null then false
          else not coalesce(public.shipment_invoice_is_void(sh.id), false)
        end as billed
      from public.shipments sh
      where sh.trip_id = t.id
        and sh.status <> 'cancelled'
    ) b
  ) s on true;

comment on view public.v_trip_revenue is
  'Ingreso de cada viaje para rentabilidad: flete de sus cargas facturadas (no canceladas; facturada = con una factura que todavía la factura, shipment_invoice_is_void); sin cargas, el ingreso manual trips.revenue. uninvoiced_freight y uninvoiced_shipments: flete y cantidad de sus cargas sin facturar (una carga por tarifa no tiene flete hasta facturarse: la cantidad dice si está pendiente). SECURITY INVOKER.';

revoke all on table public.v_trip_revenue from public, anon, authenticated;
grant select on table public.v_trip_revenue to authenticated;

------------------------------------------------------------------------------
-- 3. ai_fleet_margin
------------------------------------------------------------------------------

-- Same as 20261104194201 with billed (as in v_trip_revenue) in place of
-- invoice_id in the ship CTE.
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
      case when s.billed then coalesce(s.freight_amount, 0) else 0 end::numeric as invoiced,
      case when not s.billed then coalesce(s.freight_amount, 0) else 0 end::numeric as uninvoiced,
      case when not s.billed then 1 else 0 end as uninvoiced_n,
      sum(coalesce(s.freight_amount, 0)) over (partition by s.trip_id) as trip_freight,
      count(*) over (partition by s.trip_id) as trip_shipments,
      -- Cargas still to invoice with no freight yet (priced by tariff): the
      -- trip's split by freight is not final while there is one.
      count(*) filter (where not s.billed and s.freight_amount is null)
        over (partition by s.trip_id) as trip_unpriced,
      count(*) filter (where not s.billed and s.freight_amount is null)
        over (partition by s.trip_id, s.client_id) as own_unpriced,
      row_number() over (partition by s.trip_id, s.client_id order by s.id) as client_trip_rn
    from (
      select
        sh.id,
        sh.trip_id,
        sh.client_id,
        sh.freight_amount,
        -- Billed: linked to an invoice that still bills it (the cargas
        -- list's rule, billing_invoice_is_void, read for whoever asks).
        case
          when sh.invoice_id is null then false
          else not coalesce(public.shipment_invoice_is_void(sh.id), false)
        end as billed
      from public.shipments sh
      where sh.trip_id in (select trips_in.id from trips_in)
        and sh.status <> 'cancelled'
    ) s
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
      0::bigint as unc_shared,
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
      0::bigint,
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
      0::bigint,
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
      0::bigint,
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
      -- The other clients' unpriced cargas on this client's trips, once per
      -- trip.
      sum(case when a.client_trip_rn = 1 then a.trip_unpriced - a.own_unpriced else 0 end)::bigint,
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
        coalesce(sh.trip_unpriced, 0) as trip_unpriced,
        coalesce(sh.own_unpriced, 0) as own_unpriced,
        coalesce(sh.client_trip_rn, 1) as client_trip_rn,
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
    (g.unc + g.unc_shared)::integer,
    (sum(g.unc) over ())::integer,
    g.mnc::integer,
    (sum(g.mnc) over ())::integer
  from grouped g
  order by 10 desc, 2
  limit greatest(1, least(p_limit, 500));
$$;

comment on function public.ai_fleet_margin(date, date, text, integer, boolean) is
  'Margen de flota por viaje, chofer, vehículo o cliente en un rango: ingreso (v_trip_revenue), costo de viaje, combustible y mantenimiento. Sin viajes cancelados; el combustible y el mantenimiento cuentan por vehículo por su fecha; por vehículo, los viajes sin vehículo son el grupo none; por cliente, el costo del viaje se reparte según el flete de cada carga. Una carga está facturada si su factura todavía la factura (shipment_invoice_is_void). uninvoiced_freight y uninvoiced_shipments: flete y cantidad de las cargas sin facturar (no canceladas), fuera del ingreso (el neto de ese grupo no es definitivo); por cliente, uninvoiced_shipments suma además las cargas sin facturar y sin flete (por tarifa) de otros clientes en sus viajes, que dejan abierto su reparto del costo; total_uninvoiced_shipments cuenta cada carga una vez. maintenance_without_cost: services sin costo cargado (no están en el mantenimiento). SECURITY INVOKER.';

------------------------------------------------------------------------------
-- 4. ai_shipments_summary
------------------------------------------------------------------------------

-- Same as 20261016090000 with billed in the invoiced count.
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
    (count(*) filter (
      where s.invoice_id is not null
        and not coalesce(public.shipment_invoice_is_void(s.id), false)
    ))::integer
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

comment on function public.ai_shipments_summary(date, date) is
  'Shipments per status and client in a date range: count, freight and invoiced count (linked to an invoice that still bills them, shipment_invoice_is_void). Security invoker.';
