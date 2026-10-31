SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Fiscal filter on the AI CFO aggregates (A1) and the libro IVA channel guard.
--
-- 1. ai_client_sales_summary, ai_supplier_purchases_summary,
--    ai_supplier_upcoming_dues, ai_supplier_price_evolution, ai_payroll_summary
--    and ai_fleet_margin gain `p_is_fiscal boolean default null`: NULL reads
--    every channel (rows without a channel included, as before); true / false
--    keep only rows whose channel has that is_fiscal, so a row without a
--    channel only appears under "Todos". Signature change with defaults: drop +
--    create of a single version (no overload, no PGRST203). Bodies are the same
--    as 20261016090000 plus the filter in every CTE that reads a channelled row.
-- 2. libro_iva_ventas / libro_iva_compras reject a non-fiscal (or unknown)
--    p_channel_id with hint 'jouve_guard' instead of silently returning nothing.
--    Same signature: create or replace.
--
-- All of them stay SECURITY INVOKER (the caller's RLS applies). Dropping the
-- old signatures is safe across the deploy: the new parameter has a default,
-- so code from before this migration (named args, no p_is_fiscal) still
-- resolves to the single new version.

------------------------------------------------------------------------------
-- 1. AI aggregates
------------------------------------------------------------------------------

-- squawk-ignore ban-drop-function
drop function public.ai_payroll_summary(text, text, text, uuid);

-- Payroll totals per month (YYYY-MM) or per employee over [p_from_period,
-- p_to_period]. Concepts are the columns payroll_entries stores: net salary
-- (sueldo_neto), free-text extras, vacation pay, travel allowance (viaticos),
-- and the deductions deudas and telefono. total_a_pagar, paid and saldo come
-- from v_payroll_entries_with_payments. The schema stores net pay only: there
-- is no gross salary or employer contributions column.
-- Payroll entries carry no channel, only their payments do: with p_is_fiscal
-- set, `paid` counts the payments of that scope (the lateral below) while the
-- concepts, total_a_pagar and saldo stay the entry's own (saldo = total minus
-- every payment, so the balance never lies).
create function public.ai_payroll_summary(
  p_from_period text,
  p_to_period text,
  p_group_by text default 'month',
  p_employee_id uuid default null,
  p_is_fiscal boolean default null
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
      case when p_is_fiscal is null then r.paid_total else coalesce(sp.paid, 0) end as paid_total,
      r.saldo
    from sel_periods p
    join public.v_payroll_entries_with_payments r on r.period_id = p.id
    join public.employees e on e.id = r.employee_id
    left join lateral (
      select sum(pay.amount) as paid
      from public.payroll_payments pay
      join public.invoicing_channels c on c.id = pay.channel_id
      where p_is_fiscal is not null
        and pay.entry_id = r.id
        and c.is_fiscal = p_is_fiscal
    ) sp on true
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

-- squawk-ignore ban-drop-function
drop function public.ai_fleet_margin(date, date, text, integer);

-- Margin over [p_from, p_to] grouped by trip, driver, vehicle or client, with
-- the same imputation as the fleet profitability report: a trip carries its
-- revenue, its cost and the fuel loads tied to it; a vehicle also carries
-- every fuel load and maintenance record in the range. By client, each trip's
-- revenue and costs are split across its non-cancelled shipments by freight
-- share (equal split when no freight is set); trips without shipments go to
-- 'none'. Window totals cover every group, not only the returned page.
-- With p_is_fiscal set, only trips of that scope count (their shipments and
-- tied fuel loads follow the trip); fuel loads without a trip and maintenance
-- carry no channel, so they only count under "Todos".
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
      and (p_is_fiscal is null or exists (
        select 1 from public.invoicing_channels c
        where c.id = tr.channel_id and c.is_fiscal = p_is_fiscal
      ))
  ),
  fuel_in as (
    select fl.vehicle_id, fl.trip_id, fl.amount
    from public.fuel_loads fl
    where fl.load_date between p_from and p_to
      and (p_is_fiscal is null or fl.trip_id in (select trips_in.id from trips_in))
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

-- squawk-ignore ban-drop-function
drop function public.ai_client_sales_summary(date, date, uuid, integer);

-- Per client over [p_from, p_to]: invoiced in ARS (emitted invoices and debit
-- notes minus credit notes, at each document's cotizacion), collected by
-- currency (issued receipts), the amount-weighted average days from invoice
-- date to receipt date for the receipts in range, and the current open and
-- overdue balance (due date, else invoice date + 30 days). Window totals cover
-- every client, not only the returned page.
-- p_is_fiscal filters invoices, receipts and open documents by their channel.
create function public.ai_client_sales_summary(
  p_from date,
  p_to date,
  p_client_id uuid default null,
  p_limit integer default 50,
  p_is_fiscal boolean default null
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
      and (p_is_fiscal is null or exists (
        select 1 from public.invoicing_channels c
        where c.id = i.channel_id and c.is_fiscal = p_is_fiscal
      ))
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
      and (p_is_fiscal is null or exists (
        select 1 from public.invoicing_channels c
        where c.id = r.channel_id and c.is_fiscal = p_is_fiscal
      ))
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
      and (p_is_fiscal is null or exists (
        select 1 from public.invoicing_channels c
        where c.id = r.channel_id and c.is_fiscal = p_is_fiscal
      ))
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
    where (p_client_id is null or d.client_id = p_client_id)
      and (p_is_fiscal is null or d.channel_is_fiscal = p_is_fiscal)
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

-- squawk-ignore ban-drop-function
drop function public.ai_supplier_purchases_summary(date, date, uuid, uuid, integer);


-- Per supplier over [p_from, p_to]: purchased in ARS (received invoices and
-- debit notes minus credit notes, at each document's cotizacion), paid by
-- currency (issued payment orders), the current open and overdue balance
-- (due date, else invoice date + the supplier's payment term) and the next due
-- date. Window totals cover every supplier, not only the returned page.
-- p_is_fiscal filters purchases, payment orders and open documents by channel.
create function public.ai_supplier_purchases_summary(
  p_from date,
  p_to date,
  p_supplier_id uuid default null,
  p_category_id uuid default null,
  p_limit integer default 50,
  p_is_fiscal boolean default null
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
      and (p_is_fiscal is null or exists (
        select 1 from public.invoicing_channels c
        where c.id = pi.channel_id and c.is_fiscal = p_is_fiscal
      ))
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
      and (p_is_fiscal is null or exists (
        select 1 from public.invoicing_channels c
        where c.id = po.channel_id and c.is_fiscal = p_is_fiscal
      ))
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
    where (p_supplier_id is null or d.supplier_id = p_supplier_id)
      and (p_is_fiscal is null or d.channel_is_fiscal = p_is_fiscal)
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

-- squawk-ignore ban-drop-function
drop function public.ai_supplier_upcoming_dues(integer, uuid, integer);

-- Open supplier documents due on or before today + p_days (overdue ones
-- included), soonest first. Window totals cover every matching document.
-- p_is_fiscal filters the open documents by their channel.
create function public.ai_supplier_upcoming_dues(
  p_days integer default 30,
  p_supplier_id uuid default null,
  p_limit integer default 100,
  p_is_fiscal boolean default null
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
    where (p_supplier_id is null or d.supplier_id = p_supplier_id)
      and (p_is_fiscal is null or d.channel_is_fiscal = p_is_fiscal)
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

-- squawk-ignore ban-drop-function
drop function public.ai_supplier_price_evolution(date, date, text, uuid, uuid, text, integer);

-- Monthly purchase evolution over [p_from, p_to]. p_group_by:
--   'item'     → per supplier and normalized item description, from invoice
--                items: quantity, net ARS and the quantity-weighted average
--                unit price (requires a supplier, category or item filter);
--   'supplier' → per supplier, from invoice headers (net ARS, documents);
--   'category' → per supplier category, from invoice headers.
-- Credit notes subtract in the header modes; item mode reads invoices only.
-- p_is_fiscal filters the purchase invoices by their channel.
create function public.ai_supplier_price_evolution(
  p_from date,
  p_to date,
  p_group_by text default 'supplier',
  p_supplier_id uuid default null,
  p_category_id uuid default null,
  p_item_query text default null,
  p_limit integer default 300,
  p_is_fiscal boolean default null
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
      and (p_is_fiscal is null or exists (
        select 1 from public.invoicing_channels c
        where c.id = pi.channel_id and c.is_fiscal = p_is_fiscal
      ))
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

revoke all on function public.ai_payroll_summary(text, text, text, uuid, boolean) from public, anon;
grant execute on function public.ai_payroll_summary(text, text, text, uuid, boolean) to authenticated, service_role;
comment on function public.ai_payroll_summary(text, text, text, uuid, boolean) is
  'Payroll totals per month or per employee (net salary, extras, vacation pay, viaticos, deductions, total, paid, balance). p_is_fiscal scopes the payments (paid). Security invoker.';

revoke all on function public.ai_fleet_margin(date, date, text, integer, boolean) from public, anon;
grant execute on function public.ai_fleet_margin(date, date, text, integer, boolean) to authenticated, service_role;
comment on function public.ai_fleet_margin(date, date, text, integer, boolean) is
  'Fleet margin per trip/driver/vehicle/client with fuel and maintenance imputation and window totals; p_is_fiscal scopes the trips. Security invoker.';

revoke all on function public.ai_client_sales_summary(date, date, uuid, integer, boolean) from public, anon;
grant execute on function public.ai_client_sales_summary(date, date, uuid, integer, boolean) to authenticated, service_role;
comment on function public.ai_client_sales_summary(date, date, uuid, integer, boolean) is
  'Per-client invoiced (ARS), collected (by currency), average days to pay and open/overdue balance with window totals; p_is_fiscal scopes by channel. Security invoker.';

revoke all on function public.ai_supplier_purchases_summary(date, date, uuid, uuid, integer, boolean) from public, anon;
grant execute on function public.ai_supplier_purchases_summary(date, date, uuid, uuid, integer, boolean) to authenticated, service_role;
comment on function public.ai_supplier_purchases_summary(date, date, uuid, uuid, integer, boolean) is
  'Per-supplier purchases (ARS), payments (by currency), open/overdue balance and next due date with window totals; p_is_fiscal scopes by channel. Security invoker.';

revoke all on function public.ai_supplier_upcoming_dues(integer, uuid, integer, boolean) from public, anon;
grant execute on function public.ai_supplier_upcoming_dues(integer, uuid, integer, boolean) to authenticated, service_role;
comment on function public.ai_supplier_upcoming_dues(integer, uuid, integer, boolean) is
  'Open supplier documents due within p_days (overdue included), soonest first, with window totals; p_is_fiscal scopes by channel. Security invoker.';

revoke all on function public.ai_supplier_price_evolution(date, date, text, uuid, uuid, text, integer, boolean) from public, anon;
grant execute on function public.ai_supplier_price_evolution(date, date, text, uuid, uuid, text, integer, boolean) to authenticated, service_role;
comment on function public.ai_supplier_price_evolution(date, date, text, uuid, uuid, text, integer, boolean) is
  'Monthly purchase evolution per item (avg unit price), supplier or category; p_is_fiscal scopes by channel. Security invoker.';

------------------------------------------------------------------------------
-- 2. Libro IVA: fiscal channels only
------------------------------------------------------------------------------

create or replace function public.libro_iva_ventas(
  p_period text,
  p_channel_id text default null
)
returns table (
  invoice_id           uuid,
  fecha                date,
  kind                 text,
  letter               char(1),
  punto_venta          int,
  numero               int,
  cbte_tipo_afip       int,
  client_legal_name    text,
  doc_tipo             int,
  doc_nro              text,
  cae                  text,
  cae_vencimiento      date,
  iva_rate_id          int,
  iva_rate_pct         numeric,
  neto                 numeric,
  iva                  numeric,
  imp_trib             numeric,
  imp_op_ex            numeric,
  imp_tot_conc         numeric,
  imp_total            numeric,
  channel_id           text,
  channel_name         text,
  has_items            boolean,
  moneda               text,
  cotizacion           numeric,
  neto_orig            numeric,
  iva_orig             numeric,
  imp_trib_orig        numeric,
  imp_op_ex_orig       numeric,
  imp_tot_conc_orig    numeric,
  imp_total_orig       numeric
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'libro_iva_ventas: período inválido (esperado YYYY-MM, got %)', p_period
      using errcode = '22023';
  end if;

  if p_channel_id is not null and not exists (
    select 1 from public.invoicing_channels c
    where c.id = p_channel_id and c.is_fiscal
  ) then
    raise exception 'El libro IVA solo incluye canales fiscales.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  return query
  with periodo as (
    select
      to_date(p_period || '-01', 'YYYY-MM-DD')                          as desde,
      (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date as hasta
  ),
  fiscal_invs as (
    select
      i.id, i.fecha, i.kind, i.letter, i.punto_venta, i.numero,
      i.cbte_tipo_afip, i.client_id, i.doc_tipo, i.doc_nro, i.cae,
      i.cae_vencimiento, i.imp_neto, i.imp_iva, i.imp_trib, i.imp_op_ex,
      i.imp_tot_conc, i.imp_total, i.channel_id, i.moneda,
      case
        when i.moneda is null or i.moneda = 'PES' then 1::numeric
        else coalesce(
          nullif(i.cotizacion, 0),
          public.get_exchange_rate('USD', i.fecha),
          1
        )
      end as fx
      from public.invoices i
      join public.invoicing_channels c on c.id = i.channel_id
     where c.is_fiscal = true
       and i.status = 'emitted'
       and i.fecha between (select desde from periodo) and (select hasta from periodo)
       and (p_channel_id is null or i.channel_id = p_channel_id)
  ),
  -- Document totals in pesos, rounded like the journal entry.
  doc_ars as (
    select
      f.id,
      round((f.imp_neto + f.imp_op_ex + f.imp_tot_conc) * f.fx, 2) as revenue,
      round(f.imp_op_ex * f.fx, 2)    as op_ex,
      round(f.imp_tot_conc * f.fx, 2) as tot_conc,
      round(f.imp_iva * f.fx, 2)      as iva,
      round(f.imp_trib * f.fx, 2)     as trib
    from fiscal_invs f
  ),
  -- Items grouped per (invoice, iva_rate_id). An invoice without items yields
  -- one row with iva_rate_id null and the header neto/iva.
  per_invoice_rate as (
    select
      i.id              as invoice_id,
      it.iva_rate_id    as iva_rate_id,
      sum(it.line_neto) as neto_sum,
      sum(it.line_iva)  as iva_sum
    from fiscal_invs i
    join public.invoice_items it on it.invoice_id = i.id
    group by i.id, it.iva_rate_id
  ),
  invs_sin_items as (
    select i.id, i.imp_neto, i.imp_iva
      from fiscal_invs i
      left join public.invoice_items it on it.invoice_id = i.id
     where it.id is null
     group by i.id, i.imp_neto, i.imp_iva
  ),
  combined as (
    select
      pir.invoice_id, pir.iva_rate_id,
      pir.neto_sum as neto, pir.iva_sum as iva,
      true as has_items
    from per_invoice_rate pir
    union all
    select
      isi.id, null::int,
      isi.imp_neto, isi.imp_iva,
      false
    from invs_sin_items isi
  ),
  -- Each alícuota row rounded on its own; the largest row of the document
  -- takes the cent difference against the document total.
  rounded as (
    select
      cb.*,
      round(cb.neto * i.fx, 2) as neto_r,
      round(cb.iva * i.fx, 2)  as iva_r,
      sum(round(cb.neto * i.fx, 2)) over w as neto_r_sum,
      sum(round(cb.iva * i.fx, 2)) over w  as iva_r_sum,
      row_number() over (w order by abs(cb.neto) desc, cb.iva_rate_id nulls last) as neto_rank,
      row_number() over (w order by abs(cb.iva) desc, cb.iva_rate_id nulls last)  as iva_rank
    from combined cb
    join fiscal_invs i on i.id = cb.invoice_id
    window w as (partition by cb.invoice_id)
  )
  select
    i.id,
    i.fecha,
    i.kind,
    i.letter,
    i.punto_venta,
    i.numero,
    i.cbte_tipo_afip,
    coalesce(cl.legal_name, '—')                  as client_legal_name,
    i.doc_tipo,
    i.doc_nro,
    i.cae,
    i.cae_vencimiento,
    cb.iva_rate_id,
    case cb.iva_rate_id
      when 3 then 0
      when 4 then 10.5
      when 5 then 21
      when 6 then 27
      when 8 then 5
      when 9 then 2.5
      else null
    end::numeric                                  as iva_rate_pct,
    cb.neto_r + case when cb.neto_rank = 1
      then (d.revenue - d.op_ex - d.tot_conc) - cb.neto_r_sum else 0 end,
    cb.iva_r + case when cb.iva_rank = 1 then d.iva - cb.iva_r_sum else 0 end,
    d.trib,
    d.op_ex,
    d.tot_conc,
    d.revenue + d.iva + d.trib,
    i.channel_id,
    ch.name                                       as channel_name,
    cb.has_items,
    i.moneda,
    i.fx,
    cb.neto,
    cb.iva,
    i.imp_trib,
    i.imp_op_ex,
    i.imp_tot_conc,
    i.imp_total
  from rounded cb
  join fiscal_invs i on i.id = cb.invoice_id
  join doc_ars d on d.id = cb.invoice_id
  left join public.clients cl on cl.id = i.client_id
  join public.invoicing_channels ch on ch.id = i.channel_id
  order by i.fecha asc, i.cbte_tipo_afip asc, i.numero asc, cb.iva_rate_id asc nulls last;
end;
$$;


create or replace function public.libro_iva_compras(
  p_period text,
  p_channel_id text default null
)
returns table (
  purchase_invoice_id  uuid,
  fecha                date,
  kind                 text,
  letter               char(1),
  punto_venta          int,
  numero               int,
  supplier_legal_name  text,
  supplier_cuit        text,
  cae_proveedor        text,
  cae_vto_proveedor    date,
  iva_rate_id          int,
  iva_rate_pct         numeric,
  neto                 numeric,
  iva                  numeric,
  imp_trib             numeric,
  imp_total            numeric,
  channel_id           text,
  channel_name         text,
  has_items            boolean,
  moneda               text,
  cotizacion           numeric,
  neto_orig            numeric,
  iva_orig             numeric,
  imp_trib_orig        numeric,
  imp_total_orig       numeric
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'libro_iva_compras: período inválido (esperado YYYY-MM, got %)', p_period
      using errcode = '22023';
  end if;

  if p_channel_id is not null and not exists (
    select 1 from public.invoicing_channels c
    where c.id = p_channel_id and c.is_fiscal
  ) then
    raise exception 'El libro IVA solo incluye canales fiscales.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  return query
  with periodo as (
    select
      to_date(p_period || '-01', 'YYYY-MM-DD')                                      as desde,
      (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date as hasta
  ),
  fiscal_pis as (
    select
      p.id, p.fecha, p.kind, p.letter, p.punto_venta, p.numero, p.supplier_id,
      p.cae_proveedor, p.cae_vto_proveedor, p.imp_neto, p.imp_iva, p.imp_trib,
      p.imp_total, p.channel_id, p.moneda,
      case
        when p.moneda is null or p.moneda = 'PES' then 1::numeric
        else coalesce(
          nullif(p.cotizacion, 0),
          public.get_exchange_rate('USD', p.fecha),
          1
        )
      end as fx
      from public.purchase_invoices p
      join public.invoicing_channels c on c.id = p.channel_id
     where c.is_fiscal = true
       and p.status = 'received'
       and p.fecha between (select desde from periodo) and (select hasta from periodo)
       and (p_channel_id is null or p.channel_id = p_channel_id)
  ),
  -- Document totals in pesos, rounded like the journal entry.
  doc_ars as (
    select
      f.id,
      round(f.imp_neto * f.fx, 2) as neto,
      round(f.imp_iva * f.fx, 2)  as iva,
      round(f.imp_trib * f.fx, 2) as trib
    from fiscal_pis f
  ),
  per_pi_rate as (
    select
      p.id              as pi_id,
      it.iva_rate_id    as iva_rate_id,
      sum(it.line_neto) as neto_sum,
      sum(it.line_iva)  as iva_sum
    from fiscal_pis p
    join public.purchase_invoice_items it on it.purchase_invoice_id = p.id
    group by p.id, it.iva_rate_id
  ),
  pis_sin_items as (
    select p.id, p.imp_neto, p.imp_iva
      from fiscal_pis p
      left join public.purchase_invoice_items it on it.purchase_invoice_id = p.id
     where it.id is null
     group by p.id, p.imp_neto, p.imp_iva
  ),
  combined as (
    select pir.pi_id, pir.iva_rate_id, pir.neto_sum as neto, pir.iva_sum as iva, true as has_items
      from per_pi_rate pir
    union all
    select psi.id, null::int, psi.imp_neto, psi.imp_iva, false
      from pis_sin_items psi
  ),
  -- Each alícuota row rounded on its own; the largest row of the document
  -- takes the cent difference against the document total.
  rounded as (
    select
      cb.*,
      round(cb.neto * p.fx, 2) as neto_r,
      round(cb.iva * p.fx, 2)  as iva_r,
      sum(round(cb.neto * p.fx, 2)) over w as neto_r_sum,
      sum(round(cb.iva * p.fx, 2)) over w  as iva_r_sum,
      row_number() over (w order by abs(cb.neto) desc, cb.iva_rate_id nulls last) as neto_rank,
      row_number() over (w order by abs(cb.iva) desc, cb.iva_rate_id nulls last)  as iva_rank
    from combined cb
    join fiscal_pis p on p.id = cb.pi_id
    window w as (partition by cb.pi_id)
  )
  select
    p.id,
    p.fecha,
    p.kind,
    p.letter,
    p.punto_venta,
    p.numero,
    coalesce(s.legal_name, '—')                  as supplier_legal_name,
    s.cuit                                       as supplier_cuit,
    p.cae_proveedor,
    p.cae_vto_proveedor,
    cb.iva_rate_id,
    case cb.iva_rate_id
      when 3 then 0
      when 4 then 10.5
      when 5 then 21
      when 6 then 27
      when 8 then 5
      when 9 then 2.5
      else null
    end::numeric                                  as iva_rate_pct,
    cb.neto_r + case when cb.neto_rank = 1 then d.neto - cb.neto_r_sum else 0 end,
    cb.iva_r + case when cb.iva_rank = 1 then d.iva - cb.iva_r_sum else 0 end,
    d.trib,
    d.neto + d.iva + d.trib,
    p.channel_id,
    ch.name                                       as channel_name,
    cb.has_items,
    p.moneda,
    p.fx,
    cb.neto,
    cb.iva,
    p.imp_trib,
    p.imp_total
  from rounded cb
  join fiscal_pis p on p.id = cb.pi_id
  join doc_ars d on d.id = cb.pi_id
  left join public.suppliers s on s.id = p.supplier_id
  join public.invoicing_channels ch on ch.id = p.channel_id
  order by p.fecha asc, p.letter nulls last, p.numero asc, cb.iva_rate_id asc nulls last;
end;
$$;

