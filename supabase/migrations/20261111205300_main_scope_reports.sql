SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Reports, the AI, Resultado de gestión, tasks, the aging snapshot and the
-- tax payment's channel pick leave segregated channels out
-- (20261111205000). Bodies copied from their latest definitions; only the
-- channel filter is new. Same signatures, so callers do not change.
--
-- 1. ai_client_sales_summary, ai_client_net_revenue,
--    ai_supplier_purchases_summary, ai_supplier_upcoming_dues,
--    ai_supplier_price_evolution, late_interest_candidates.
-- 2. management_pnl_lines (20261111185300): the journal arm, the internal
--    documents, the pending dollars and the cash movements of a segregated
--    channel stay out. get_management_pnl(_documents) read it.
-- 3. sync_automatic_tasks and capture_aging_snapshot skip segregated
--    documents.
-- 4. pay_tax_document picks the first active fiscal channel of the main app.
--
-- The libro IVA, journal, ledger and balance keep every channel.

-- 1. Reports and the AI -------------------------------------------------------------

-- 20261105231000
create or replace function public.ai_client_sales_summary(
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
      and public.channel_in_main_scope(i.channel_id)
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
      and public.channel_in_main_scope(r.channel_id)
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
      and public.channel_in_main_scope(r.channel_id)
    group by r.client_id
  ),
  debt as (
    select
      d.client_id,
      sum(d.open_amount) filter (where d.moneda = 'PES') as open_ars,
      sum(d.open_amount) filter (where d.moneda <> 'PES') as open_foreign,
      sum(d.open_amount) filter (
        where d.moneda = 'PES' and d.due_date < current_date
      ) as overdue_ars
    from public.v_aging_documents d
    where (p_client_id is null or d.client_id = p_client_id)
      and (p_is_fiscal is null or d.channel_is_fiscal = p_is_fiscal)
      and not coalesce(d.channel_is_segregated, false)
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
revoke all on function public.ai_client_sales_summary(date, date, uuid, integer, boolean) from public, anon;
grant execute on function public.ai_client_sales_summary(date, date, uuid, integer, boolean) to authenticated, service_role;

-- 20261103150000
create or replace function public.ai_client_net_revenue(
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
      and public.channel_in_main_scope(i.channel_id)
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
revoke all on function public.ai_client_net_revenue(date, date, boolean, integer, integer) from public, anon;
grant execute on function public.ai_client_net_revenue(date, date, boolean, integer, integer) to authenticated, service_role;

-- 20261104096600
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
      and public.channel_in_main_scope(pi.channel_id)
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
      and public.channel_in_main_scope(po.channel_id)
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
      and not coalesce(d.channel_is_segregated, false)
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
revoke all on function public.ai_supplier_purchases_summary(date, date, uuid, uuid, integer, boolean) from public, anon;
grant execute on function public.ai_supplier_purchases_summary(date, date, uuid, uuid, integer, boolean) to authenticated, service_role;

-- 20261031184339
create or replace function public.ai_supplier_upcoming_dues(
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
      and not coalesce(d.channel_is_segregated, false)
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
revoke all on function public.ai_supplier_upcoming_dues(integer, uuid, integer, boolean) from public, anon;
grant execute on function public.ai_supplier_upcoming_dues(integer, uuid, integer, boolean) to authenticated, service_role;

-- 20261104096600
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
      and public.channel_in_main_scope(pi.channel_id)
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
revoke all on function public.ai_supplier_price_evolution(date, date, text, uuid, uuid, text, integer, boolean) from public, anon;
grant execute on function public.ai_supplier_price_evolution(date, date, text, uuid, uuid, text, integer, boolean) to authenticated, service_role;

-- 20261105231000
create or replace function public.late_interest_candidates(p_as_of date)
returns table (
  invoice_id      uuid,
  client_id       uuid,
  client_name     text,
  channel_id      text,
  channel_is_fiscal boolean,
  kind            text,
  letter          text,
  punto_venta     integer,
  numero          integer,
  fecha           date,
  due_date        date,
  moneda          text,
  open_amount     numeric,
  charged_to      date,
  charge_from     date,
  client_rate     numeric,
  monthly_rate    numeric,
  balance_days    numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.invoice_id,
         d.client_id,
         cl.legal_name,
         d.channel_id,
         d.channel_is_fiscal,
         d.kind,
         d.letter::text,
         d.punto_venta,
         d.numero,
         d.fecha,
         d.due_date,
         d.moneda,
         d.open_amount,
         lc.charged_to,
         cf.charge_from,
         cl.late_interest_monthly_rate,
         coalesce(cl.late_interest_monthly_rate,
                  (select (s.value #>> '{}')::numeric
                     from public.finance_settings s
                    where s.key = 'late_interest_monthly_rate')),
         greatest(p_as_of - cf.charge_from + 1, 0) * d.open_amount
           + public.late_interest_reductions_after(d.invoice_id, cf.charge_from, p_as_of)
    from public.v_aging_documents d
    join public.clients cl on cl.id = d.client_id
    left join lateral (
      select max(c.period_to) as charged_to
        from public.late_interest_charges c
       where c.invoice_id = d.invoice_id
         and public.late_interest_charge_is_live(c)
    ) lc on true
    cross join lateral (
      select greatest(d.due_date, coalesce(lc.charged_to, d.fecha)) + 1
               as charge_from
    ) cf
   where d.document_type = 'invoice'
     and d.open_amount > 0
     and not coalesce(d.channel_is_segregated, false)
     and d.due_date < p_as_of
     and not exists (select 1 from public.late_interest_charges x
                      where x.nd_invoice_id = d.invoice_id)
   order by cl.legal_name, d.due_date, d.invoice_id
$$;
revoke all on function public.late_interest_candidates(date) from public, anon, authenticated;
grant execute on function public.late_interest_candidates(date) to service_role;

-- 2. Resultado de gestión (20261111185300) ------------------------------------------------

create or replace function public.management_pnl_lines(
  p_from  date,
  p_to    date,
  p_basis text
)
returns table (
  month            text,
  bucket           text,
  subbucket        text,
  channel_side     text,
  chart_account_id uuid,
  cost_center_id   uuid,
  amount_ars       numeric,
  pending_usd      numeric,
  source_table     text,
  source_id        uuid
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_from date := date_trunc('month', p_from)::date;
  v_to   date := (date_trunc('month', p_to) + interval '1 month - 1 day')::date;
begin
  if p_basis is null or p_basis not in ('accrual', 'cash') then
    raise exception 'Base inválida: %', p_basis
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  if p_basis = 'accrual' then
    return query
    with raw as (
      -- Fiscal: the journal as posted (reversals included). A manual entry
      -- is its own source.
      -- The recibo gap (source payroll_entries) is left out: the same
      -- money is the payroll_discount internal salary below.
      select je.accrual_period as month, 'fiscal'::text as side,
             coalesce(je.source_table, 'journal_entries') as source_table,
             coalesce(je.source_id, je.id) as source_id,
             je.cost_center_id,
             l.chart_of_accounts_id as account_id,
             l.credit - l.debit as amount
        from public.journal_entries je
        join public.journal_entry_lines l on l.journal_entry_id = je.id
       where je.accrual_period between to_char(v_from, 'YYYY-MM') and to_char(v_to, 'YYYY-MM')
         and je.source_table is distinct from 'payroll_entries'
         and public.channel_in_main_scope(je.channel_id)
      union all
      -- Internal: the entry each live document would post.
      select d.e ->> 'accrual_period', 'internal', x.src, x.id,
             (d.e ->> 'cost_center_id')::uuid,
             coalesce((ln ->> 'account_id')::uuid,
                      public.find_account_by_role((ln ->> 'system_role')::public.coa_system_role)),
             coalesce((ln ->> 'credit')::numeric, 0) - coalesce((ln ->> 'debit')::numeric, 0)
        from (
          select 'invoices'::text as src, i.id
            from public.invoices i
            join public.invoicing_channels c on c.id = i.channel_id
           where not c.is_fiscal and not c.is_segregated and i.status = 'emitted' and i.fecha between v_from and v_to
          union all
          select 'purchase_invoices', p.id
            from public.purchase_invoices p
            join public.invoicing_channels c on c.id = p.channel_id
           where not c.is_fiscal and not c.is_segregated and p.status = 'received' and p.fecha between v_from and v_to
          union all
          select 'transactions', t.id
            from public.transactions t
            join public.invoicing_channels c on c.id = t.channel_id
           where not c.is_fiscal and not c.is_segregated and t.accrual_month between v_from and v_to
        ) x
        cross join lateral (select public.journal_document_entry(x.src, x.id) as e) d
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(d.e -> 'lines') = 'array' then d.e -> 'lines' else '[]'::jsonb end) ln
       where d.e is not null
      union all
      -- Employee account: what the planilla discounted (the advance it repays
      -- was an asset) and a forgiven company debt are internal salaries.
      select to_char(m.movement_date, 'YYYY-MM'), 'internal', 'employee_account_movements', m.id,
             null::uuid, public.find_account_by_role('sueldos'),
             -round(m.amount * case when m.currency = 'USD'
                                    then public.get_exchange_rate('USD', m.movement_date) else 1 end, 2)
        from public.employee_account_movements m
       where m.movement_date between v_from and v_to
         and (m.kind = 'payroll_discount' or (m.kind = 'forgiveness' and m.creditor = 'empresa'))
         and (m.currency = 'ARS' or public.get_exchange_rate('USD', m.movement_date) is not null)
    ),
    classified as (
      select r.month, r.side, r.source_table, r.source_id, r.cost_center_id, r.account_id, r.amount,
             case
               -- A cuota's capital posted to the loan liability is principal
               -- paid, below the operating margin; its interest goes to its
               -- own account's bucket.
               when r.source_table = 'transactions'
                    and coa.system_role = 'prestamos'
                    and inst.id is not null
                 then 'loan_principal'
               -- An unsplit cuota posted whole to an expense is principal
               -- paid too: the loan has no booked liability (the builder
               -- expenses the whole cuota), or its entry predates the
               -- capital-first posting (20261104093100: no prestamos line
               -- although the schedule still owed capital). Otherwise the
               -- builder already moved the capital to prestamos and the
               -- result line is interest.
               when r.source_table = 'transactions'
                    and coa.account_type in ('resultado_positivo', 'resultado_negativo')
                    and inst.id is not null
                    and inst.capital_amount is null
                    and (not inst.booked
                         or (inst.owes_capital
                             and not bool_or(coa.system_role is not distinct from 'prestamos')
                                       over (partition by r.side, r.source_table, r.source_id)))
                 then 'loan_principal'
               when mb.bucket is not null then mb.bucket
               when coa.account_type in ('resultado_positivo', 'resultado_negativo') then 'unclassified'
             end as bucket,
             mb.subbucket,
             case when r.source_table = 'invoices' and coa.system_role = 'ventas'
                  then public.management_invoice_asset_share(r.source_id) else 0 end as asset_share
        from raw r
        left join public.chart_of_accounts coa on coa.id = r.account_id
        left join public.management_buckets mb on mb.chart_of_accounts_id = r.account_id
        -- The cuota a treasury movement paid, with the builder's predicate
        -- (build_transaction_journal_lines, 20261104093100).
        left join lateral (
          select li.id, li.capital_amount,
                 (lo.disbursement_transaction_id is not null or lo.import_run_id is not null) as booked,
                 lo.principal - coalesce((
                   select sum(coalesce(o.capital_amount, o.amount))
                     from public.loan_installments o
                    where o.loan_id = li.loan_id
                      and o.number < li.number
                 ), 0) > 0 as owes_capital
            from public.loan_installments li
            join public.loans lo on lo.id = li.loan_id
           where r.source_table = 'transactions'
             and li.transaction_id = r.source_id
           limit 1
        ) inst on true
    )
    select c.month,
           case when s.is_asset then 'asset_sale' else c.bucket end,
           case when c.subbucket = 'sueldos' and c.side = 'internal' then 'sueldos_internos'
                else c.subbucket end,
           c.side, c.account_id, c.cost_center_id, s.part, 0::numeric,
           c.source_table, c.source_id
      from classified c
      cross join lateral (values
        (false, c.amount - round(c.amount * c.asset_share, 2)),
        (true,  round(c.amount * c.asset_share, 2))
      ) as s (is_asset, part)
     where c.bucket is not null and c.bucket <> 'neutral'
       and (s.part <> 0 or (not s.is_asset and c.asset_share = 0))
    union all
    -- A USD movement without a rate: in dollars, never summed.
    select to_char(t.accrual_month, 'YYYY-MM'), 'pending_usd', null,
           case when c.is_fiscal then 'fiscal' else 'internal' end,
           null, t.cost_center_id, 0::numeric,
           case when t.kind = 'income' then t.amount else -t.amount end,
           'transactions', t.id
      from public.transactions t
      join public.invoicing_channels c on c.id = t.channel_id
     where t.currency = 'USD'
       and not c.is_segregated
       and t.kind in ('income', 'expense')
       and t.invoice_id is null and t.receipt_id is null and t.payment_order_id is null
       and t.issued_check_id is null
       -- Movements whose entry is not a result: a loan disbursement, a check
       -- movement or rejection, an opening-balance adjustment, a tax payment.
       and t.manual_check_id is null and t.rejected_check_id is null
       and not exists (select 1 from public.loans lo where lo.disbursement_transaction_id = t.id)
       and not exists (select 1 from public.check_movements cm where cm.transaction_id = t.id)
       and not exists (select 1 from public.account_opening_balances aob
                        where aob.adjustment_transaction_id = t.id)
       and not exists (select 1 from public.tax_documents td where td.payment_transaction_id = t.id)
       and t.accrual_month between v_from and v_to
       -- Fiscal: the journal is the source, so pending while it has no live
       -- entry (a rate loaded later, back-dated, posts nothing by itself).
       -- Internal: the entry is built now, at today's rates.
       and case when c.is_fiscal
                then not exists (select 1 from public.current_journal_entries('transactions', t.id))
                else public.get_exchange_rate('USD', t.transaction_date) is null
           end
       and not exists (select 1 from public.employee_account_movements m where m.transaction_id = t.id)
    union all
    -- A USD payroll discount or forgiven company debt with no rate that day:
    -- internal salaries in dollars, pending like any other.
    select to_char(m.movement_date, 'YYYY-MM'), 'pending_usd', null, 'internal',
           null, null::uuid, 0::numeric, -m.amount,
           'employee_account_movements', m.id
      from public.employee_account_movements m
     where m.movement_date between v_from and v_to
       and (m.kind = 'payroll_discount' or (m.kind = 'forgiveness' and m.creditor = 'empresa'))
       and m.currency = 'USD'
       and public.get_exchange_rate('USD', m.movement_date) is null;
    return;
  end if;

  -- Cash: every movement of every account and channel, by its source, with
  -- the shares that leave the operating lines carved out.
  return query
  with base as (
    select t.id, t.transaction_date, t.currency, t.cost_center_id,
           -- A USD receipt or payment order is valued at its own cotización,
           -- the rate its entry booked; anything else at the day's rate.
           case when t.currency = 'USD' then
             case when t.receipt_id is not null then
                    (select case when r.cotizacion > 1 then r.cotizacion end
                       from public.receipts r where r.id = t.receipt_id)
                  when t.payment_order_id is not null then
                    (select case when po.cotizacion > 1 then po.cotizacion end
                       from public.payment_orders po where po.id = t.payment_order_id)
             end
           end as doc_rate,
           to_char(t.transaction_date, 'YYYY-MM') as month,
           case when c.is_fiscal then 'fiscal' else 'internal' end as side,
           case when t.kind = 'income' then t.amount else -t.amount end as signed,
           case
             -- A check imported at go-live (its cartera inflow and, if it
             -- bounces, its outflow): an opening item. The debt and the check
             -- predate the system; no collection happened.
             when ick.id is not null then 'neutral'
             when t.receipt_id is not null or t.invoice_id is not null
                  or t.manual_check_id is not null then 'service_revenue'
             -- A rejected check's outflow (the bank's debit-back, the refund
             -- to a buyer, the cartera's): it takes back the collection the
             -- check had counted.
             when t.rejected_check_id is not null then 'service_revenue'
             when t.payment_order_id is not null or t.issued_check_id is not null then 'operating_cost'
             when emp.owned then 'employee_advances'
             when t.is_payroll
                  or exists (select 1 from public.payroll_payments pp where pp.transaction_id = t.id)
               then 'operating_cost'
             when li.id is not null then 'loan_principal'
             -- The income a loan put in the bank: financing received, below
             -- cash generation.
             when ld.id is not null then 'loan_disbursements'
             when exists (select 1 from public.check_movements cm where cm.transaction_id = t.id)
                  or exists (select 1 from public.account_opening_balances aob
                              where aob.adjustment_transaction_id = t.id)
               then 'neutral'
             -- A tax payment goes where the tax account is mapped, or to
             -- the operating taxes line (the account is usually a liability,
             -- which has no bucket).
             when td.id is not null then coalesce(tmb.bucket, 'operating_cost')
             -- A tax credit booked from a bank statement line (SIRCREB,
             -- percepciones) is a tax paid in cash.
             when public.is_bank_tax_account(cp.id) then 'operating_cost'
             -- A loose movement goes where its journal counter-account goes.
             else coalesce(mb.bucket, 'unclassified')
           end as bucket,
           case
             when t.receipt_id is not null or t.invoice_id is not null
                  or t.manual_check_id is not null or t.rejected_check_id is not null then null
             when t.payment_order_id is not null or t.issued_check_id is not null then 'proveedores'
             when emp.owned then null
             when t.is_payroll
                  or exists (select 1 from public.payroll_payments pp where pp.transaction_id = t.id)
               then case when c.is_fiscal then 'sueldos' else 'sueldos_internos' end
             when li.id is not null or ld.id is not null then null
             when td.id is not null then
               case when tmb.bucket is null then 'impuestos' else tmb.subbucket end
             when public.is_bank_tax_account(cp.id) then 'impuestos'
             else mb.subbucket
           end as subbucket,
           case when td.id is not null then td.account_id
                when t.receipt_id is null and t.invoice_id is null and t.manual_check_id is null
                     and t.rejected_check_id is null and t.payment_order_id is null
                     and t.issued_check_id is null and not t.is_payroll
                     and not emp.owned and li.id is null and ld.id is null
                then cp.id end as account_id,
           -- Share of a collection that paid asset sales. A rejected check
           -- takes back the share of the receipt that collected it.
           case
             when t.receipt_id is not null or t.rejected_check_id is not null then (
               select least(1, greatest(0,
                        coalesce(sum(ra.amount_applied * public.management_invoice_asset_share(ra.invoice_id)), 0)
                        / nullif(max(r.total_amount), 0)))
                 from public.receipts r
                 left join public.receipt_allocations ra on ra.receipt_id = r.id
                where r.id = coalesce(t.receipt_id,
                        (select k.source_receipt_id from public.checks k where k.id = t.rejected_check_id)))
             when t.invoice_id is not null then public.management_invoice_asset_share(t.invoice_id)
             else 0
           end as f_asset,
           op.f_employee,
           op.f_fleet,
           op.f_neutral,
           -- Share of an installment that is not capital. An unsplit cuota
           -- of a loan with its liability booked pays the capital the
           -- schedule still owes first, as its entry does.
           case when li.capital_amount is not null and li.amount > 0
                  then greatest(0, least(1, (li.amount - li.capital_amount) / li.amount))
                when li.default_capital is not null and t.amount > 0
                  then greatest(0, least(1, (t.amount - li.default_capital) / t.amount))
                else 0 end as f_interest
      from public.transactions t
      join public.invoicing_channels c on c.id = t.channel_id
      left join public.checks ick
        on ick.id = coalesce(t.manual_check_id, t.rejected_check_id)
       and ick.import_run_id is not null
      cross join lateral (
        select exists (select 1 from public.employee_account_movements m where m.transaction_id = t.id) as owned
      ) emp
      left join lateral (
        select li.id, li.amount, li.capital_amount,
               case when li.capital_amount is null
                         and (lo.disbursement_transaction_id is not null or lo.import_run_id is not null)
                    then greatest(0, least(t.amount, lo.principal - coalesce((
                           select sum(coalesce(o.capital_amount, o.amount))
                             from public.loan_installments o
                            where o.loan_id = li.loan_id
                              and o.number < li.number
                         ), 0)))
               end as default_capital
          from public.loan_installments li
          join public.loans lo on lo.id = li.loan_id
         where li.transaction_id = t.id
         limit 1
      ) li on true
      left join lateral (
        select lo.id from public.loans lo where lo.disbursement_transaction_id = t.id limit 1
      ) ld on true
      -- payment_transaction_id is unique: one document at most.
      left join public.tax_documents td on td.payment_transaction_id = t.id
      left join public.management_buckets tmb on tmb.chart_of_accounts_id = td.account_id
      left join public.issued_checks ic on ic.id = t.issued_check_id
      cross join lateral public.management_payment_order_shares(
        coalesce(t.payment_order_id, ic.payment_order_id), 3) op
      left join public.chart_of_accounts cp
        on cp.id = coalesce(
             case when t.kind = 'expense' then t.expense_account_id end,
             public.find_account_by_role(
               case when t.kind = 'income' then 'ajustes_caja' else 'gastos' end::public.coa_system_role))
      left join public.management_buckets mb on mb.chart_of_accounts_id = cp.id
     where t.kind in ('income', 'expense')
       and not c.is_segregated
       and t.transaction_date between v_from and v_to
  ),
  -- Where the non-capital share of an installment goes: the bucket of
  -- intereses_pagados, as in accrual (financing cost without that account).
  interest_account as (
    select coa.id,
           coalesce(mb.bucket, 'unclassified') as bucket,
           case when mb.bucket is null then null else mb.subbucket end as subbucket
      from public.chart_of_accounts coa
      left join public.management_buckets mb on mb.chart_of_accounts_id = coa.id
     where coa.id = public.find_account_by_role('intereses_pagados')
    union all
    select null::uuid, 'financing_cost', 'intereses'
     where public.find_account_by_role('intereses_pagados') is null
  ),
  parts as (
    select b.month, b.side, b.cost_center_id, b.currency, b.transaction_date, b.doc_rate, b.id,
           p.bucket, p.subbucket, p.account_id, p.part
      from base b
      cross join lateral (
        select x.bucket, x.subbucket, x.account_id, x.part
          from (values
            ('asset_sale'::text, null::text, null::uuid, round(b.signed * b.f_asset, 2)),
            ('employee_advances', null, null, round(b.signed * b.f_employee, 2)),
            ('fleet_investment', null, null, round(b.signed * b.f_fleet, 2)),
            ('neutral', null, null, round(b.signed * b.f_neutral, 2)),
            ((select ia.bucket from interest_account ia limit 1),
             (select ia.subbucket from interest_account ia limit 1),
             (select ia.id from interest_account ia limit 1),
             round(b.signed * b.f_interest, 2))
          ) as x (bucket, subbucket, account_id, part)
         where x.part <> 0
        union all
        select b.bucket, b.subbucket, b.account_id,
               b.signed - round(b.signed * b.f_asset, 2) - round(b.signed * b.f_employee, 2)
                        - round(b.signed * b.f_fleet, 2) - round(b.signed * b.f_neutral, 2)
                        - round(b.signed * b.f_interest, 2)
      ) p
     where p.bucket <> 'neutral'
  ),
  rated as (
    select p.*,
           case when p.currency = 'USD'
                then coalesce(p.doc_rate, public.get_exchange_rate('USD', p.transaction_date))
                else 1 end as rate
      from parts p
  )
  select r.month, r.bucket, r.subbucket, r.side, r.account_id, r.cost_center_id,
         case when r.rate is not null then round(r.part * r.rate, 2) else 0 end,
         case when r.rate is null then r.part else 0 end,
         'transactions'::text, r.id
    from rated r
  union all
  -- Payroll discount / forgiven company debt: internal salaries of the month,
  -- and the same amount back from the advances (no cash moves).
  -- A USD one with no rate that day stays in dollars (pending_usd).
  select to_char(m.movement_date, 'YYYY-MM'), x.bucket, x.subbucket, 'internal', null::uuid, null::uuid,
         case when mr.rate is not null then x.sign * round(m.amount * mr.rate, 2) else 0 end,
         case when mr.rate is null then x.sign * m.amount else 0 end,
         'employee_account_movements', m.id
    from public.employee_account_movements m
    cross join lateral (
      select case when m.currency = 'USD'
                  then public.get_exchange_rate('USD', m.movement_date) else 1 end as rate
    ) mr
    cross join lateral (values
      ('operating_cost'::text, 'sueldos_internos'::text, -1),
      ('employee_advances', null, 1)
    ) as x (bucket, subbucket, sign)
   where m.movement_date between v_from and v_to
     and (m.kind = 'payroll_discount' or (m.kind = 'forgiveness' and m.creditor = 'empresa'));
end;
$$;

revoke all on function public.management_pnl_lines(date, date, text) from public, anon, authenticated;

-- 3. Tasks (20261106191306) and the aging snapshot (20261104060100) -------------------------

create or replace function public.sync_automatic_tasks(p_today date)
returns table (task_id uuid, kind text, change text)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform set_config('jouve.syncing_tasks', 'on', true);
  return query
    with desired as (
      select
        'purchase_invoices'::text as source_table,
        d.purchase_invoice_id as source_id,
        'supplier_payment'::text as kind,
        format('Pagar a %s: %s', s.legal_name, concat_ws(' ',
          case d.kind when 'nd' then 'ND' else 'Factura' end,
          d.letter,
          lpad(d.punto_venta::text, 4, '0') || '-' || lpad(d.numero::text, 8, '0'))) as title,
        coalesce(d.fch_vto_pago, d.fecha) as due_date
      from public.v_supplier_aging_documents d
      join public.suppliers s on s.id = d.supplier_id
      where d.document_type = 'purchase_invoice'
        and not coalesce(d.channel_is_segregated, false)
        and coalesce(d.fch_vto_pago, d.fecha) <= p_today + 7

      union all

      select
        'invoices',
        d.invoice_id,
        'collection',
        format('Cobrar a %s: %s', c.legal_name, concat_ws(' ',
          case d.kind when 'nd' then 'ND' else 'Factura' end,
          d.letter,
          lpad(d.punto_venta::text, 4, '0') || '-' || coalesce(lpad(d.numero::text, 8, '0'), 's/n'))),
        d.due_date
      from public.v_aging_documents d
      join public.clients c on c.id = d.client_id
      where d.document_type = 'invoice'
        and not coalesce(d.channel_is_segregated, false)
        and d.due_date < p_today

      union all

      select
        'loan_installments',
        li.id,
        'loan_installment',
        format('Pagar cuota %s de %s', li.number, l.description),
        li.due_date
      from public.loan_installments li
      join public.loans l on l.id = li.loan_id
      where li.status = 'pendiente'
        and l.status = 'active'
        and li.due_date <= p_today + 7

      union all

      select
        'issued_checks',
        ic.id,
        'issued_check',
        format('Cubrir cheque propio N° %s (%s)', ic.check_number, ic.bank_name),
        ic.due_date
      from public.issued_checks ic
      where ic.status = 'emitted'
        and ic.due_date <= p_today + 7

      union all

      select
        'fleet_documents',
        fd.id,
        'fleet_document',
        format('Renovar %s de %s', replace(fd.kind, '_', ' '), coalesce(v.patente, dr.full_name)),
        fd.expires_at
      from public.fleet_documents fd
      left join public.vehicles v on v.id = fd.vehicle_id
      left join public.drivers dr on dr.id = fd.driver_id
      where fd.expires_at <= p_today + 30
        and coalesce(v.is_active, dr.is_active, false)
        and not exists (
          select 1 from public.fleet_documents n
           where n.id <> fd.id
             and n.kind = fd.kind
             and n.vehicle_id is not distinct from fd.vehicle_id
             and n.driver_id is not distinct from fd.driver_id
             and n.expires_at > p_today + 30
        )

      union all

      select
        'employee_documents',
        ed.id,
        'employee_document',
        format('Renovar %s de %s', replace(ed.kind::text, '_', ' '), e.legal_name),
        ed.expires_at
      from public.employee_documents ed
      join public.employees e on e.id = ed.employee_id
      where ed.expires_at <= p_today + 30
        and e.is_active
        and not exists (
          select 1 from public.employee_documents n
           where n.id <> ed.id
             and n.employee_id = ed.employee_id
             and n.kind = ed.kind
             and n.expires_at > p_today + 30
        )

      union all

      select
        'tax_documents',
        td.id,
        'tax_document',
        format('Pagar %s del período %s',
          public.tax_document_label(td.kind, td.title, td.jurisdiction),
          to_char(to_date(td.period, 'YYYY-MM'), 'MM/YYYY')),
        td.due_date
      from public.tax_documents td
      where td.status in ('pendiente', 'liquidado')
        and td.due_date <= p_today + 7
        -- A month whose IVA DDJJ only leaves a saldo a favor has nothing to pay.
        and not (td.amount is null and td.credit_balance is not null)
    ),
    upserted as (
      insert into public.tasks as t (title, due_date, origin, kind, source_table, source_id)
      select d.title, d.due_date, 'automatic', d.kind, d.source_table, d.source_id
        from desired d
      on conflict (source_table, source_id, kind) do update
        set title = excluded.title,
            due_date = case when t.due_date_locked then t.due_date else excluded.due_date end,
            notified_stage = case
              when t.due_date_locked or t.due_date = excluded.due_date then t.notified_stage
            end,
            status = case when t.auto_closed then 'open' else t.status end,
            completed_at = case when t.auto_closed then null else t.completed_at end,
            auto_closed = false
        where t.title is distinct from excluded.title
           or (not t.due_date_locked and t.due_date is distinct from excluded.due_date)
           or t.auto_closed
      returning t.id, t.kind, (t.xmax = 0) as inserted
    ),
    closed as (
      update public.tasks t
         set status = 'done',
             completed_at = now(),
             completed_by = null,
             auto_closed = true
       where t.origin = 'automatic'
         and t.status = 'open'
         and not exists (
           select 1 from desired d
            where d.source_table = t.source_table
              and d.source_id = t.source_id
              and d.kind = t.kind
         )
      returning t.id, t.kind
    )
    select u.id, u.kind, case when u.inserted then 'created' else 'updated' end
      from upserted u
    union all
    select c.id, c.kind, 'closed'
      from closed c;
  perform set_config('jouve.syncing_tasks', '', true);
end;
$$;
revoke all on function public.sync_automatic_tasks(date) from public, anon, authenticated;
grant execute on function public.sync_automatic_tasks(date) to service_role;

create or replace function public.capture_aging_snapshot()
returns date
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin']) then
    raise exception 'No autorizado para registrar la foto del aging'
      using errcode = '42501';
  end if;

  insert into public.aging_snapshots as s (
    snapshot_date,
    ars_bucket_0_30, ars_bucket_30_60, ars_bucket_60_90, ars_bucket_90_plus,
    ars_total_open, ars_overdue,
    usd_bucket_0_30, usd_bucket_30_60, usd_bucket_60_90, usd_bucket_90_plus,
    usd_total_open, usd_overdue,
    document_count, client_count, captured_at
  )
  select
    current_date,
    coalesce(sum(d.open_amount) filter (where not d.is_usd and d.bucket = '0_30'), 0),
    coalesce(sum(d.open_amount) filter (where not d.is_usd and d.bucket = '30_60'), 0),
    coalesce(sum(d.open_amount) filter (where not d.is_usd and d.bucket = '60_90'), 0),
    coalesce(sum(d.open_amount) filter (where not d.is_usd and d.bucket = '90_plus'), 0),
    coalesce(sum(d.open_amount) filter (where not d.is_usd), 0),
    coalesce(sum(d.open_amount) filter (where not d.is_usd and d.days_overdue > 0), 0),
    coalesce(sum(d.open_amount) filter (where d.is_usd and d.bucket = '0_30'), 0),
    coalesce(sum(d.open_amount) filter (where d.is_usd and d.bucket = '30_60'), 0),
    coalesce(sum(d.open_amount) filter (where d.is_usd and d.bucket = '60_90'), 0),
    coalesce(sum(d.open_amount) filter (where d.is_usd and d.bucket = '90_plus'), 0),
    coalesce(sum(d.open_amount) filter (where d.is_usd), 0),
    coalesce(sum(d.open_amount) filter (where d.is_usd and d.days_overdue > 0), 0),
    count(*),
    count(distinct d.client_id),
    now()
  from (
    select a.client_id, a.open_amount, a.bucket, a.days_overdue,
           coalesce(a.moneda, 'PES') in ('DOL', 'USD') as is_usd
      from public.v_aging_documents a
     where not coalesce(a.channel_is_segregated, false)
  ) d
  on conflict (snapshot_date) do update set
    ars_bucket_0_30    = excluded.ars_bucket_0_30,
    ars_bucket_30_60   = excluded.ars_bucket_30_60,
    ars_bucket_60_90   = excluded.ars_bucket_60_90,
    ars_bucket_90_plus = excluded.ars_bucket_90_plus,
    ars_total_open     = excluded.ars_total_open,
    ars_overdue        = excluded.ars_overdue,
    usd_bucket_0_30    = excluded.usd_bucket_0_30,
    usd_bucket_30_60   = excluded.usd_bucket_30_60,
    usd_bucket_60_90   = excluded.usd_bucket_60_90,
    usd_bucket_90_plus = excluded.usd_bucket_90_plus,
    usd_total_open     = excluded.usd_total_open,
    usd_overdue        = excluded.usd_overdue,
    document_count     = excluded.document_count,
    client_count       = excluded.client_count,
    captured_at        = excluded.captured_at;

  return current_date;
end;
$$;
revoke all on function public.capture_aging_snapshot() from public, anon, authenticated;
grant execute on function public.capture_aging_snapshot() to service_role;

-- 4. Tax payment channel (20261104092200) -----------------------------------------------

create or replace function public.pay_tax_document(
  p_tax_document_id uuid,
  p_paid_date       date,
  p_account_id      uuid,
  p_amount          numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc          public.tax_documents;
  v_account_type text;
  v_currency     text;
  v_channel_id   text;
  v_period       text := to_char(p_paid_date, 'YYYY-MM');
  v_tx_id        uuid;
begin
  -- Role guard (taxes:write holders in lib/auth/permissions.ts). The service
  -- role passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para registrar pagos de impuestos'
      using errcode = '42501';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'El importe pagado tiene que ser mayor a cero'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if p_paid_date is null then
    raise exception 'Indicá la fecha de pago'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select * into v_doc
    from public.tax_documents td
   where td.id = p_tax_document_id
     and td.status in ('pendiente', 'liquidado')
     for update;
  if not found then
    raise exception 'El impuesto no existe o ya está pagado o anulado'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_doc.account_id is null then
    raise exception 'Elegí la cuenta contable del impuesto antes de pagarlo'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if exists (select 1 from public.accounting_closed_periods where period = v_period) then
    raise exception 'El período contable % está cerrado: usá una fecha de pago de un período abierto o pedí que lo reabran en Contabilidad.', v_period
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  select a.type, a.currency into v_account_type, v_currency
    from public.accounts a
   where a.id = p_account_id and a.is_active;
  if not found then
    raise exception 'La cuenta de pago no existe o está inactiva'
      using errcode = '23503', hint = 'jouve_guard';
  end if;
  if v_account_type in ('checks', 'echeq') then
    raise exception 'Los movimientos en cuentas de cheques se manejan desde Cheques (cargar, depositar, endosar)'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_currency <> 'ARS' then
    raise exception 'Los impuestos se pagan en pesos: elegí una cuenta en ARS'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select c.id into v_channel_id
    from public.invoicing_channels c
   where c.is_fiscal and c.is_active and not c.is_segregated
   order by c.id
   limit 1;
  if v_channel_id is null then
    raise exception 'No hay un canal fiscal activo para registrar el pago'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  insert into public.transactions (
    account_id, channel_id, kind, amount, currency, transaction_date,
    accrual_month, description, created_by
  ) values (
    p_account_id, v_channel_id, 'expense', p_amount, 'ARS', p_paid_date,
    date_trunc('month', p_paid_date)::date,
    format('Pago de %s — período %s',
      public.tax_document_label(v_doc.kind, v_doc.title, v_doc.jurisdiction),
      to_char(to_date(v_doc.period, 'YYYY-MM'), 'MM/YYYY')),
    auth.uid()
  )
  returning id into v_tx_id;

  update public.tax_documents
     set status = 'pagado',
         amount = coalesce(amount, p_amount),
         payment_transaction_id = v_tx_id,
         paid_date = p_paid_date,
         paid_amount = p_amount,
         payment_origin = 'pay',
         -- The row before this update: what the undo restores.
         payment_previous_amount = amount,
         payment_previous_status = status
   where id = p_tax_document_id;

  -- Posted at insert as a loose expense; now the builder sees the document.
  perform public.repost_journal('transactions', v_tx_id);

  return v_tx_id;
end;
$$;
revoke all on function public.pay_tax_document(uuid, date, uuid, numeric) from public, anon, authenticated;
grant execute on function public.pay_tax_document(uuid, date, uuid, numeric) to authenticated, service_role;
