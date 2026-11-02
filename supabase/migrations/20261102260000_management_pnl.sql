SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Roadmap 1.0: Resultado de gestión v1, an internal view of whether the
-- operation makes money. It adds the fiscal books (journal entries) and the
-- internal documents (computed on the fly with journal_document_entry) and
-- never writes an entry: the fiscal journal, get_account_balances and the
-- EERR stay as they are. Only owner, admin and finance read it (the app gate
-- is management:read); fiscal_reader never does.
--
--   1. management_buckets: chart account → management bucket (+ subbucket),
--      seeded from the chart's codes and system roles. A result account
--      without a row reads as 'unclassified'.
--   2. management_invoice_asset_share: the share of an invoice's net that
--      its items mark as asset sales (invoice_items.revenue_kind).
--   3. get_management_pnl(from, to, basis, inflation): rows (month, bucket,
--      subbucket, side, account, amount in pesos, USD still without a rate).
--   4. get_management_payroll_control(from, to): liquidated vs paid per
--      payroll period, and paid in each month.

-- 1. Buckets -----------------------------------------------------------------------

create table public.management_buckets (
  chart_of_accounts_id uuid primary key
    references public.chart_of_accounts (id) on delete cascade,
  bucket     text not null check (bucket in (
    'service_revenue', 'operating_cost', 'financing_cost', 'loan_principal',
    'fleet_investment', 'asset_sale', 'neutral', 'excluded_noncash')),
  subbucket  text check (subbucket in (
    'sueldos', 'cargas_sociales', 'combustible', 'mantenimiento', 'seguros',
    'peajes', 'alquileres', 'impuestos', 'administracion', 'proveedores', 'otros',
    'intereses', 'cargos_bancarios', 'descuento_cheques', 'cargos_prestamos')),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint management_buckets_subbucket_scope check (
    subbucket is null or bucket in ('operating_cost', 'financing_cost'))
);

comment on table public.management_buckets is
  'Resultado de gestión (uso interno): a qué caja va cada cuenta del plan. No cambia asientos ni el EERR fiscal.';

create index management_buckets_updated_by_idx on public.management_buckets (updated_by);

alter table public.management_buckets enable row level security;

revoke all on table public.management_buckets from public, anon, authenticated;
grant select, insert, update, delete on table public.management_buckets to authenticated;
grant all on table public.management_buckets to service_role;

create policy "management roles read buckets"
  on public.management_buckets for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

create policy "owner and admin insert buckets"
  on public.management_buckets for insert to authenticated
  with check ((select public.user_has_role(array['owner', 'admin'])));

create policy "owner and admin update buckets"
  on public.management_buckets for update to authenticated
  using ((select public.user_has_role(array['owner', 'admin'])))
  with check ((select public.user_has_role(array['owner', 'admin'])));

create policy "owner and admin delete buckets"
  on public.management_buckets for delete to authenticated
  using ((select public.user_has_role(array['owner', 'admin'])));

-- Seed: by code (the shipped chart), then by system role, then by name.
insert into public.management_buckets (chart_of_accounts_id, bucket, subbucket)
select coa.id, m.bucket, m.subbucket
  from (values
    ('4.1.1', 'service_revenue',  null),
    ('4.2.1', 'financing_cost',   'intereses'),
    ('4.2.2', 'excluded_noncash', null),
    ('4.3.1', 'neutral',          null),
    ('5.1.1', 'operating_cost',   'otros'),
    ('5.2.1', 'operating_cost',   'combustible'),
    ('5.2.2', 'operating_cost',   'mantenimiento'),
    ('5.2.3', 'operating_cost',   'peajes'),
    ('5.2.4', 'operating_cost',   'mantenimiento'),
    ('5.3.1', 'operating_cost',   'sueldos'),
    ('5.3.2', 'operating_cost',   'administracion'),
    ('5.3.3', 'operating_cost',   'administracion'),
    ('5.3.4', 'operating_cost',   'alquileres'),
    ('5.3.5', 'operating_cost',   'otros'),
    ('5.4.1', 'financing_cost',   'intereses'),
    ('5.4.2', 'financing_cost',   'cargos_bancarios')
  ) as m (code, bucket, subbucket)
  join public.chart_of_accounts coa on coa.code = m.code
on conflict (chart_of_accounts_id) do nothing;

insert into public.management_buckets (chart_of_accounts_id, bucket, subbucket)
select coa.id, m.bucket, m.subbucket
  from (values
    ('ventas',       'service_revenue', null),
    ('compras',      'operating_cost',  'otros'),
    ('gastos',       'operating_cost',  'otros'),
    ('sueldos',      'operating_cost',  'sueldos'),
    ('ajustes_caja', 'neutral',         null)
  ) as m (role, bucket, subbucket)
  join public.chart_of_accounts coa on coa.system_role::text = m.role
on conflict (chart_of_accounts_id) do nothing;

insert into public.management_buckets (chart_of_accounts_id, bucket, subbucket)
select coa.id,
       case
         when coa.name ilike '%amortiz%' or coa.name ilike '%recpam%'
           or coa.name ilike '%poder adquisitivo%' then 'excluded_noncash'
         when coa.account_type = 'activo' then 'fleet_investment'
         else 'operating_cost'
       end,
       case
         when coa.name ilike '%amortiz%' or coa.name ilike '%recpam%'
           or coa.name ilike '%poder adquisitivo%' or coa.account_type = 'activo' then null
         when coa.name ilike '%cargas sociales%' or coa.name ilike '%sindica%'
           or coa.name ilike '%obra social%' then 'cargas_sociales'
         when coa.name ilike '%seguro%' then 'seguros'
         when coa.name ilike '%ingresos brutos%' or coa.name ilike '%tasa%' then 'impuestos'
         else 'otros'
       end
  from public.chart_of_accounts coa
 where coa.is_active
   and (
     (coa.account_type in ('resultado_positivo', 'resultado_negativo')
       and (coa.name ilike '%amortiz%' or coa.name ilike '%recpam%'
         or coa.name ilike '%poder adquisitivo%' or coa.name ilike '%cargas sociales%'
         or coa.name ilike '%sindica%' or coa.name ilike '%obra social%'
         or coa.name ilike '%seguro%' or coa.name ilike '%ingresos brutos%'))
     or (coa.account_type = 'activo'
       and (coa.name ilike '%rodado%' or coa.name ilike '%leasing%' or coa.name ilike '%plan de ahorro%'))
   )
on conflict (chart_of_accounts_id) do nothing;

-- 2. Asset share of an invoice ------------------------------------------------------

create or replace function public.management_invoice_asset_share(p_invoice_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(
    sum(ii.line_neto) filter (where ii.revenue_kind = 'asset_sale')
      / nullif(sum(ii.line_neto), 0),
    0)
    from public.invoice_items ii
   where ii.invoice_id = p_invoice_id;
$$;

revoke all on function public.management_invoice_asset_share(uuid) from public, anon, authenticated;

-- 3. The management P&L ---------------------------------------------------------------

-- amount_ars > 0 adds to the result, < 0 takes from it. A USD movement with no
-- rate on or before its date is not converted: it comes back as its own row
-- (bucket 'pending_usd', amount_ars 0, pending_usd in dollars), never summed.
create or replace function public.get_management_pnl(
  p_from      date,
  p_to        date,
  p_basis     text default 'accrual',
  p_inflation boolean default false
)
returns table (
  month            text,
  bucket           text,
  subbucket        text,
  channel_side     text,
  chart_account_id uuid,
  amount_ars       numeric,
  pending_usd      numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date := date_trunc('month', p_from)::date;
  v_to   date := (date_trunc('month', p_to) + interval '1 month - 1 day')::date;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para ver el resultado de gestión'
      using errcode = '42501';
  end if;
  if p_basis is null or p_basis not in ('accrual', 'cash') then
    raise exception 'Base inválida: %', p_basis
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Período inválido'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  if p_basis = 'accrual' then
    return query
    with raw as (
      -- Fiscal: the journal as posted (reversals included).
      select je.accrual_period as month, 'fiscal'::text as side,
             je.source_table, je.source_id,
             l.chart_of_accounts_id as account_id,
             l.credit - l.debit as amount
        from public.journal_entries je
        join public.journal_entry_lines l on l.journal_entry_id = je.id
       where je.accrual_period between to_char(v_from, 'YYYY-MM') and to_char(v_to, 'YYYY-MM')
      union all
      -- Internal: the entry each live document would post.
      select d.e ->> 'accrual_period', 'internal', x.src, x.id,
             coalesce((ln ->> 'account_id')::uuid,
                      public.find_account_by_role((ln ->> 'system_role')::public.coa_system_role)),
             coalesce((ln ->> 'credit')::numeric, 0) - coalesce((ln ->> 'debit')::numeric, 0)
        from (
          select 'invoices'::text as src, i.id
            from public.invoices i
            join public.invoicing_channels c on c.id = i.channel_id
           where not c.is_fiscal and i.status = 'emitted' and i.fecha between v_from and v_to
          union all
          select 'purchase_invoices', p.id
            from public.purchase_invoices p
            join public.invoicing_channels c on c.id = p.channel_id
           where not c.is_fiscal and p.status = 'received' and p.fecha between v_from and v_to
          union all
          select 'transactions', t.id
            from public.transactions t
            join public.invoicing_channels c on c.id = t.channel_id
           where not c.is_fiscal and t.accrual_month between v_from and v_to
        ) x
        cross join lateral (select public.journal_document_entry(x.src, x.id) as e) d
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(d.e -> 'lines') = 'array' then d.e -> 'lines' else '[]'::jsonb end) ln
       where d.e is not null
    ),
    classified as (
      select r.month, r.side, r.account_id, r.amount,
             case
               -- A loan installment is posted to an expense: in gestión it
               -- is principal paid, below the operating margin.
               when r.source_table = 'transactions'
                    and coa.account_type in ('resultado_positivo', 'resultado_negativo')
                    and exists (select 1 from public.loan_installments li where li.transaction_id = r.source_id)
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
    ),
    split as (
      select c.month, c.side, c.account_id, c.subbucket,
             case when s.is_asset then 'asset_sale' else c.bucket end as bucket,
             s.part as amount
        from classified c
        cross join lateral (values
          (false, c.amount - round(c.amount * c.asset_share, 2)),
          (true,  round(c.amount * c.asset_share, 2))
        ) as s (is_asset, part)
       where c.bucket is not null and c.bucket <> 'neutral'
         and (s.part <> 0 or (not s.is_asset and c.asset_share = 0))
    ),
    pending as (
      select to_char(t.accrual_month, 'YYYY-MM') as month,
             case when c.is_fiscal then 'fiscal' else 'internal' end as side,
             sum(case when t.kind = 'income' then t.amount else -t.amount end) as usd
        from public.transactions t
        join public.invoicing_channels c on c.id = t.channel_id
       where t.currency = 'USD'
         and t.kind in ('income', 'expense')
         and t.invoice_id is null and t.receipt_id is null and t.payment_order_id is null
         and t.issued_check_id is null
         and t.accrual_month between v_from and v_to
         and public.get_exchange_rate('USD', t.transaction_date) is null
       group by 1, 2
    )
    select s.month, s.bucket,
           case when s.subbucket = 'sueldos' and s.side = 'internal' then 'sueldos_internos'
                else s.subbucket end,
           s.side, s.account_id,
           round(sum(s.amount) * case when p_inflation then coalesce(max(ia.coefficient), 1) else 1 end, 2),
           0::numeric
      from split s
      left join public.inflation_adjustments ia on ia.period = s.month
     group by s.month, s.bucket, s.subbucket, s.side, s.account_id
    union all
    select p.month, 'pending_usd', null, p.side, null, 0::numeric, p.usd
      from pending p;
    return;
  end if;

  -- Cash: every movement of every account and channel, by its source.
  return query
  with moves as (
    select to_char(t.transaction_date, 'YYYY-MM') as month,
           case when c.is_fiscal then 'fiscal' else 'internal' end as side,
           t.currency, t.transaction_date,
           case when t.kind = 'income' then t.amount else -t.amount end as signed,
           case
             when t.receipt_id is not null or t.invoice_id is not null
                  or t.manual_check_id is not null then 'service_revenue'
             when t.payment_order_id is not null or t.issued_check_id is not null then 'operating_cost'
             when t.is_payroll
                  or exists (select 1 from public.payroll_payments pp where pp.transaction_id = t.id)
               then 'operating_cost'
             when exists (select 1 from public.loan_installments li where li.transaction_id = t.id)
               then 'loan_principal'
             when t.rejected_check_id is not null
                  or exists (select 1 from public.check_movements cm where cm.transaction_id = t.id)
                  or exists (select 1 from public.account_opening_balances aob
                              where aob.adjustment_transaction_id = t.id)
               then 'neutral'
             -- A loose movement goes where its journal counter-account goes.
             else coalesce(mb.bucket, 'unclassified')
           end as bucket,
           case
             when t.receipt_id is not null or t.invoice_id is not null
                  or t.manual_check_id is not null then null
             when t.payment_order_id is not null or t.issued_check_id is not null then 'proveedores'
             when t.is_payroll
                  or exists (select 1 from public.payroll_payments pp where pp.transaction_id = t.id)
               then case when c.is_fiscal then 'sueldos' else 'sueldos_internos' end
             else mb.subbucket
           end as subbucket,
           case when t.receipt_id is null and t.invoice_id is null and t.manual_check_id is null
                     and t.payment_order_id is null and t.issued_check_id is null and not t.is_payroll
                then cp.id end as account_id
      from public.transactions t
      join public.invoicing_channels c on c.id = t.channel_id
      left join public.chart_of_accounts cp
        on cp.id = public.find_account_by_role(
             case when t.kind = 'income' then 'ajustes_caja' else 'gastos' end::public.coa_system_role)
      left join public.management_buckets mb on mb.chart_of_accounts_id = cp.id
     where t.kind in ('income', 'expense')
       and t.transaction_date between v_from and v_to
  ),
  rated as (
    select m.*,
           case when m.currency = 'USD' then public.get_exchange_rate('USD', m.transaction_date) else 1 end as rate
      from moves m
     where m.bucket <> 'neutral'
  )
  select r.month, r.bucket, r.subbucket, r.side, r.account_id,
         round(coalesce(sum(r.signed * r.rate) filter (where r.rate is not null), 0)
               * case when p_inflation then coalesce(max(ia.coefficient), 1) else 1 end, 2),
         coalesce(sum(r.signed) filter (where r.rate is null), 0)
    from rated r
    left join public.inflation_adjustments ia on ia.period = r.month
   group by r.month, r.bucket, r.subbucket, r.side, r.account_id;
end;
$$;

revoke all on function public.get_management_pnl(date, date, text, boolean) from public, anon, authenticated;
grant execute on function public.get_management_pnl(date, date, text, boolean) to service_role;

-- 4. Payroll control: liquidated vs paid ---------------------------------------------

create or replace function public.get_management_payroll_control(p_from date, p_to date)
returns table (
  month             text,
  liquidated        numeric,
  paid_for_period   numeric,
  paid_in_month     numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para ver el resultado de gestión'
      using errcode = '42501';
  end if;

  return query
  with months as (
    select to_char(m, 'YYYY-MM') as month
      from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') m
  ),
  liq as (
    select to_char(make_date(pp.year, pp.month, 1), 'YYYY-MM') as month,
           sum(r.total_a_pagar) as amount
      from public.payroll_periods pp
      join public.v_payroll_entries_resolved r on r.period_id = pp.id
     group by 1
  ),
  paid_for as (
    select to_char(make_date(pp.year, pp.month, 1), 'YYYY-MM') as month,
           sum(pay.amount) as amount
      from public.payroll_payments pay
      join public.payroll_entries e on e.id = pay.entry_id
      join public.payroll_periods pp on pp.id = e.period_id
     group by 1
  ),
  paid_in as (
    select to_char(pay.paid_at, 'YYYY-MM') as month, sum(pay.amount) as amount
      from public.payroll_payments pay
     group by 1
  )
  select m.month,
         coalesce(l.amount, 0),
         coalesce(f.amount, 0),
         coalesce(i.amount, 0)
    from months m
    left join liq l on l.month = m.month
    left join paid_for f on f.month = m.month
    left join paid_in i on i.month = m.month
   order by m.month;
end;
$$;

revoke all on function public.get_management_payroll_control(date, date) from public, anon, authenticated;
grant execute on function public.get_management_payroll_control(date, date) to service_role;
