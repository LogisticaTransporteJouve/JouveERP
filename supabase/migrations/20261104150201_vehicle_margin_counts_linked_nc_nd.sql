SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Margen por camión: the NC/ND of a purchase that a fuel load or a service
-- links counts in its cost center, as in Gestión. Same signature, columns and
-- body as 20261104092100 (its latest definition), without the NC/ND in the
-- set of documents the fleet side already counts.
--
-- That set left out the NC/ND as "already counted", but the fleet side is the
-- user-typed fuel_loads.amount / maintenance_records.cost, which no NC or ND
-- changes: a $200 NC of a $1000 linked service left the truck at $1000 while
-- Gestión counted $800, and an ND was lost the same way. The linked purchase
-- itself is still left out (the fleet side counts it). The NC/ND reaches the
-- truck through its center, which it inherits from the purchase
-- (purchase_nc_nd_inherit_account).
--
-- Rollback: same columns; older code reads center_cost as a number.

create or replace function public.get_vehicle_margin(
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
  'Margen por camión (gestión, uso interno, devengado, meses completos): ingreso, viajes, combustible y mantenimiento (ai_fleet_margin) más el costo operativo y lo sin clasificar del centro de costo del camión (cost_centers.vehicle_id), sin contar dos veces la compra o el movimiento que una carga de combustible o un service ya imputa (la NC/ND de esa compra sí cuenta, en su centro). Lo que no es de un camión va aparte (no_vehicle, unlinked_center, no_center).';

revoke all on function public.get_vehicle_margin(date, date) from public, anon, authenticated;
grant execute on function public.get_vehicle_margin(date, date) to service_role;
