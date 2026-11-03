SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Margen por camión: a "Sin clasificar" cost loaded with a truck's cost center
-- is a cost of that truck. get_vehicle_margin keeps its signature and
-- columns; the rest is the definition of 20261104050000.
--
-- The center part read only operating_cost (and pending_usd), so a purchase
-- or expense tagged with truck A's center whose expense account has no
-- management_buckets row (bucket unclassified) was in no row: not the truck's,
-- not unlinked_center, not no_center. Gestión counts unclassified in the
-- operating margin "so no peso is left out"; now center_cost does too, for
-- trucks and for the unlinked_center / no_center rows alike.
--
-- Rollback: same columns; older code reads center_cost as a number.

-- Same as 20261104050000 plus unclassified in the center part.
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
     where l.bucket in ('operating_cost', 'unclassified', 'pending_usd')
       and not exists (
         select 1 from linked_all k where k.src = l.source_table and k.id = l.source_id
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
  'Margen por camión (gestión, uso interno, devengado, meses completos): ingreso, viajes, combustible y mantenimiento (ai_fleet_margin) más el costo operativo y lo sin clasificar del centro de costo del camión (cost_centers.vehicle_id), sin contar dos veces lo que una carga de combustible o un service ya imputa. Lo que no es de un camión va aparte (no_vehicle, unlinked_center, no_center).';

revoke all on function public.get_vehicle_margin(date, date) from public, anon, authenticated;
grant execute on function public.get_vehicle_margin(date, date) to service_role;
