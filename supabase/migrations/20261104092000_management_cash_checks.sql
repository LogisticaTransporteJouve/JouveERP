SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Resultado de gestión: checks in cash basis and fiscal USD pending.
-- Internal use only: nothing here writes an entry or touches the builders or
-- the fiscal books. management_pnl_lines keeps its signature and columns;
-- the rest is the definition of 20261104050200.
--
--   1. Cash: a third-party check imported at go-live (checks.import_run_id)
--      is an opening item. Its cartera inflow (checks_manual_inflow) and, if
--      it bounces, its rejection outflow go to neutral. They counted as
--      "Servicios" of the import month (the accrual side was already neutral:
--      the entry credits ajustes de caja).
--   2. Cash: the outflow of a rejected check (transactions.rejected_check_id:
--      the bank's debit-back of a deposited check, the refund to the buyer of
--      a sold one, the cartera's) is service_revenue, negative: it takes back
--      the collection the check counted. It was neutral, so the collection
--      stayed and a later re-collection counted twice. Accrual: unchanged
--      (the entry debits Deudores por cheques rechazados, not a result).
--   3. Accrual pending_usd: a fiscal USD movement is pending while it has no
--      live journal entry, not while it has no rate today. A rate loaded
--      later for an earlier date posts nothing by itself (the movement waits
--      for a re-post, listed by journal_missing_entries), so the movement
--      dropped out of both the pesos and the pending figures. Internal
--      movements are built now and keep the rate test.
--
-- Rollback: older code already knows neutral, service_revenue and
-- pending_usd; only the figures move between them.

-- Same as 20261104050200 plus the three changes in the header.
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
      select je.accrual_period as month, 'fiscal'::text as side,
             coalesce(je.source_table, 'journal_entries') as source_table,
             coalesce(je.source_id, je.id) as source_id,
             je.cost_center_id,
             l.chart_of_accounts_id as account_id,
             l.credit - l.debit as amount
        from public.journal_entries je
        join public.journal_entry_lines l on l.journal_entry_id = je.id
       where je.accrual_period between to_char(v_from, 'YYYY-MM') and to_char(v_to, 'YYYY-MM')
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
               -- An unsplit loan installment is posted to an expense: in
               -- gestión it is principal paid, below the operating margin.
               -- A split one posts its capital to the loan liability
               -- (principal) and its interest to its own account's bucket.
               when r.source_table = 'transactions'
                    and coa.system_role = 'prestamos'
                    and exists (select 1 from public.loan_installments li where li.transaction_id = r.source_id)
                 then 'loan_principal'
               when r.source_table = 'transactions'
                    and coa.account_type in ('resultado_positivo', 'resultado_negativo')
                    and exists (select 1 from public.loan_installments li
                                 where li.transaction_id = r.source_id and li.capital_amount is null)
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
       and t.kind in ('income', 'expense')
       and t.invoice_id is null and t.receipt_id is null and t.payment_order_id is null
       and t.issued_check_id is null
       and t.accrual_month between v_from and v_to
       -- Fiscal: the journal is the source, so pending while it has no live
       -- entry (a rate loaded later, back-dated, posts nothing by itself).
       -- Internal: the entry is built now, at today's rates.
       and case when c.is_fiscal
                then not exists (select 1 from public.current_journal_entries('transactions', t.id))
                else public.get_exchange_rate('USD', t.transaction_date) is null
           end
       and not exists (select 1 from public.employee_account_movements m where m.transaction_id = t.id);
    return;
  end if;

  -- Cash: every movement of every account and channel, by its source, with
  -- the shares that leave the operating lines carved out.
  return query
  with base as (
    select t.id, t.transaction_date, t.currency, t.cost_center_id,
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
             else mb.subbucket
           end as subbucket,
           case when td.id is not null then td.account_id
                when t.receipt_id is null and t.invoice_id is null and t.manual_check_id is null
                     and t.rejected_check_id is null and t.payment_order_id is null
                     and t.issued_check_id is null and not t.is_payroll
                     and not emp.owned and li.id is null and ld.id is null
                then cp.id end as account_id,
           -- Share of a collection that paid asset sales.
           case
             when t.receipt_id is not null then (
               select least(1, greatest(0,
                        coalesce(sum(ra.amount_applied * public.management_invoice_asset_share(ra.invoice_id)), 0)
                        / nullif(max(r.total_amount), 0)))
                 from public.receipts r
                 left join public.receipt_allocations ra on ra.receipt_id = r.id
                where r.id = t.receipt_id)
             when t.invoice_id is not null then public.management_invoice_asset_share(t.invoice_id)
             else 0
           end as f_asset,
           op.f_employee,
           op.f_fleet,
           -- Share of an installment that is not capital.
           case when li.capital_amount is not null and li.amount > 0
                then greatest(0, least(1, (li.amount - li.capital_amount) / li.amount))
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
        select li.id, li.amount, li.capital_amount
          from public.loan_installments li
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
      cross join lateral (
        -- least() skips nulls: coalesce first, or no OP would read as 1.
        select least(1, coalesce(a.employee, 0)) as f_employee,
               least(1 - least(1, coalesce(a.employee, 0)), coalesce(a.fleet, 0)) as f_fleet
          from (
            select sum(poa.amount_applied) filter (where pi.charged_employee_id is not null)
                     / nullif(max(po.total_amount), 0) as employee,
                   sum(poa.amount_applied) filter (where pi.charged_employee_id is null
                                                     and pmb.bucket = 'fleet_investment')
                     / nullif(max(po.total_amount), 0) as fleet
              from public.payment_orders po
              join public.payment_order_allocations poa on poa.payment_order_id = po.id
              join public.purchase_invoices pi on pi.id = poa.purchase_invoice_id
              left join public.management_buckets pmb on pmb.chart_of_accounts_id = pi.account_id
             where po.id = coalesce(t.payment_order_id, ic.payment_order_id)
          ) a
      ) op
      left join public.chart_of_accounts cp
        on cp.id = coalesce(
             case when t.kind = 'expense' then t.expense_account_id end,
             public.find_account_by_role(
               case when t.kind = 'income' then 'ajustes_caja' else 'gastos' end::public.coa_system_role))
      left join public.management_buckets mb on mb.chart_of_accounts_id = cp.id
     where t.kind in ('income', 'expense')
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
    select b.month, b.side, b.cost_center_id, b.currency, b.transaction_date, b.id,
           p.bucket, p.subbucket, p.account_id, p.part
      from base b
      cross join lateral (
        select x.bucket, x.subbucket, x.account_id, x.part
          from (values
            ('asset_sale'::text, null::text, null::uuid, round(b.signed * b.f_asset, 2)),
            ('employee_advances', null, null, round(b.signed * b.f_employee, 2)),
            ('fleet_investment', null, null, round(b.signed * b.f_fleet, 2)),
            ((select ia.bucket from interest_account ia limit 1),
             (select ia.subbucket from interest_account ia limit 1),
             (select ia.id from interest_account ia limit 1),
             round(b.signed * b.f_interest, 2))
          ) as x (bucket, subbucket, account_id, part)
         where x.part <> 0
        union all
        select b.bucket, b.subbucket, b.account_id,
               b.signed - round(b.signed * b.f_asset, 2) - round(b.signed * b.f_employee, 2)
                        - round(b.signed * b.f_fleet, 2) - round(b.signed * b.f_interest, 2)
      ) p
     where p.bucket <> 'neutral'
  ),
  rated as (
    select p.*,
           case when p.currency = 'USD' then public.get_exchange_rate('USD', p.transaction_date) else 1 end as rate
      from parts p
  )
  select r.month, r.bucket, r.subbucket, r.side, r.account_id, r.cost_center_id,
         case when r.rate is not null then r.part * r.rate else 0 end,
         case when r.rate is null then r.part else 0 end,
         'transactions'::text, r.id
    from rated r
  union all
  -- Payroll discount / forgiven company debt: internal salaries of the month,
  -- and the same amount back from the advances (no cash moves).
  select to_char(m.movement_date, 'YYYY-MM'), x.bucket, x.subbucket, 'internal', null::uuid, null::uuid,
         x.sign * round(m.amount * case when m.currency = 'USD'
                                        then public.get_exchange_rate('USD', m.movement_date) else 1 end, 2),
         0::numeric,
         'employee_account_movements', m.id
    from public.employee_account_movements m
    cross join lateral (values
      ('operating_cost'::text, 'sueldos_internos'::text, -1),
      ('employee_advances', null, 1)
    ) as x (bucket, subbucket, sign)
   where m.movement_date between v_from and v_to
     and (m.kind = 'payroll_discount' or (m.kind = 'forgiveness' and m.creditor = 'empresa'))
     and (m.currency = 'ARS' or public.get_exchange_rate('USD', m.movement_date) is not null);
end;
$$;

comment on function public.management_pnl_lines(date, date, text) is
  'Resultado de gestión (uso interno) por documento, nominal. Lo suman get_management_pnl y get_management_pnl_documents.';

revoke all on function public.management_pnl_lines(date, date, text) from public, anon, authenticated;
