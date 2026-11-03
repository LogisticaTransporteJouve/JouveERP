SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A purchase's net for the AI supplier figures includes exento and no gravado,
-- now that they have their own columns (20261104096400); the sales twin
-- (ai_cross_queries) already adds imp_op_ex and imp_tot_conc. Same signatures
-- and return types as 20261031184339, so the grants carry over.

create or replace function public.ai_supplier_purchases_summary(
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
      sum(case when pi.kind = 'nc' then -1 else 1 end * (pi.imp_neto + pi.imp_no_gravado + pi.imp_op_exentas) * coalesce(nullif(pi.cotizacion, 0), 1)) as net_ars,
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

create or replace function public.ai_supplier_price_evolution(
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
      pi.imp_neto + pi.imp_no_gravado + pi.imp_op_exentas as imp_neto
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
