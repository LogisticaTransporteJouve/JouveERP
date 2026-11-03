SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Resultado de gestión: loan disbursements in cash basis. Internal use only:
-- nothing here writes an entry or touches the builders or the fiscal books.
--
--   1. management_pnl_lines (same signature and columns): in cash, the income
--      a loan put in the bank (loans.disbursement_transaction_id, written or
--      adopted by record_loan_disbursement) is a line of the new bucket
--      'loan_disbursements' ("Financiamiento recibido"), positive, on the
--      movement's date, converted like every other movement (USD without a
--      rate comes back as pending_usd). Until now it fell to the
--      counter-account of a loose income (ajustes_caja = neutral) and never
--      counted, while each installment's capital did. Accrual: unchanged (the
--      disbursement credits the prestamos liability, not a result account).
--   2. get_management_pnl_documents (same signature and columns): a
--      disbursement line opens its loan, labelled "Desembolso: ..." and dated
--      on the movement.
--   3. get_management_pnl: unchanged; it sums the lines.
--
-- Rollback: older code narrows each row against the buckets it knows and
-- logs 'loan_disbursements' as unknown (management.pnl.unknown_rows /
-- management.drill.unknown_rows) without adding it to any figure, so it
-- shows the same cascade it showed before this migration.

-- 1. Lines --------------------------------------------------------------------------

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
       and public.get_exchange_rate('USD', t.transaction_date) is null
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
             when t.receipt_id is not null or t.invoice_id is not null
                  or t.manual_check_id is not null then 'service_revenue'
             when t.payment_order_id is not null or t.issued_check_id is not null then 'operating_cost'
             when emp.owned then 'employee_advances'
             when t.is_payroll
                  or exists (select 1 from public.payroll_payments pp where pp.transaction_id = t.id)
               then 'operating_cost'
             when li.id is not null then 'loan_principal'
             -- The income a loan put in the bank: financing received, below
             -- cash generation.
             when ld.id is not null then 'loan_disbursements'
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
             when emp.owned then null
             when t.is_payroll
                  or exists (select 1 from public.payroll_payments pp where pp.transaction_id = t.id)
               then case when c.is_fiscal then 'sueldos' else 'sueldos_internos' end
             when li.id is not null or ld.id is not null then null
             else mb.subbucket
           end as subbucket,
           case when t.receipt_id is null and t.invoice_id is null and t.manual_check_id is null
                     and t.payment_order_id is null and t.issued_check_id is null and not t.is_payroll
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

-- 2. Drill-down: the documents behind a figure ---------------------------------------

create or replace function public.get_management_pnl_documents(
  p_from    date,
  p_to      date,
  p_basis   text,
  p_buckets text[] default null
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
  doc_type         text,
  doc_id           uuid,
  doc_parent_id    uuid,
  doc_subtype      text,
  doc_date         date,
  doc_label        text,
  counterparty     text
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
  if p_basis is null or p_basis not in ('accrual', 'cash') then
    raise exception 'Base inválida: %', p_basis
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Período inválido'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  return query
  with l as materialized (
    select * from public.management_pnl_lines(p_from, p_to, p_basis) x
     where p_buckets is null or x.bucket = any (p_buckets)
  ),
  docs as (
    select l.month, l.bucket, l.subbucket, l.channel_side, l.chart_account_id, l.cost_center_id,
           l.amount_ars, l.pending_usd,
           case l.source_table
             when 'invoices' then 'invoice'
             when 'purchase_invoices' then 'purchase_invoice'
             when 'receipts' then 'receipt'
             when 'payment_orders' then 'payment_order'
             when 'checks' then 'check'
             when 'issued_checks' then 'issued_check'
             when 'employee_account_movements' then 'employee'
             when 'transactions' then tx.doc_type
             else 'journal_entry'
           end as doc_type,
           case l.source_table
             when 'employee_account_movements' then eam.employee_id
             when 'transactions' then tx.doc_id
             else l.source_id
           end as doc_id,
           tx.parent_id
      from l
      left join lateral (
        -- The document that owns a treasury movement.
        select case
                 when t.receipt_id is not null then 'receipt'
                 when coalesce(t.payment_order_id, ic.payment_order_id) is not null then 'payment_order'
                 when t.issued_check_id is not null then 'issued_check'
                 when t.invoice_id is not null then 'invoice'
                 when pe.period_id is not null then 'payroll'
                 when li.loan_id is not null then 'loan'
                 when ld.id is not null then 'loan'
                 when em.employee_id is not null then 'employee'
                 else 'transaction'
               end as doc_type,
               case
                 when t.receipt_id is not null then t.receipt_id
                 when coalesce(t.payment_order_id, ic.payment_order_id) is not null
                   then coalesce(t.payment_order_id, ic.payment_order_id)
                 when t.issued_check_id is not null then t.issued_check_id
                 when t.invoice_id is not null then t.invoice_id
                 when pe.period_id is not null then pe.period_id
                 when li.loan_id is not null then li.loan_id
                 when ld.id is not null then ld.id
                 when em.employee_id is not null then em.employee_id
                 else t.id
               end as doc_id,
               t.account_id as parent_id
          from public.transactions t
          left join public.issued_checks ic on ic.id = t.issued_check_id
          left join lateral (
            select e.period_id
              from public.payroll_payments pp
              join public.payroll_entries e on e.id = pp.entry_id
             where pp.transaction_id = t.id
             limit 1
          ) pe on true
          left join lateral (
            select i.loan_id from public.loan_installments i where i.transaction_id = t.id limit 1
          ) li on true
          left join lateral (
            select lo.id from public.loans lo where lo.disbursement_transaction_id = t.id limit 1
          ) ld on true
          left join lateral (
            select m.employee_id from public.employee_account_movements m where m.transaction_id = t.id limit 1
          ) em on true
         where l.source_table = 'transactions' and t.id = l.source_id
      ) tx on true
      left join public.employee_account_movements eam
        on l.source_table = 'employee_account_movements' and eam.id = l.source_id
  ),
  grouped as (
    select d.month, d.bucket, d.subbucket, d.channel_side, d.chart_account_id, d.cost_center_id,
           sum(d.amount_ars) as amount, sum(d.pending_usd) as pending,
           d.doc_type, d.doc_id,
           case when d.doc_type = 'transaction' then max(d.parent_id::text)::uuid end as parent_id
      from docs d
     group by d.month, d.bucket, d.subbucket, d.channel_side, d.chart_account_id, d.cost_center_id,
              d.doc_type, d.doc_id
  )
  select g.month, g.bucket, g.subbucket, g.channel_side, g.chart_account_id, g.cost_center_id,
         round(g.amount, 2), g.pending, g.doc_type, g.doc_id, g.parent_id,
         lab.subtype, lab.doc_date, lab.label, lab.counterparty
    from grouped g
    left join lateral (
      select null::text as subtype, i.fecha as doc_date,
             case i.kind
               when 'factura' then case when c.is_fiscal then 'Factura' else 'Remito interno' end
               when 'nc' then case when c.is_fiscal then 'Nota de Crédito' else 'Nota de crédito interna' end
               else case when c.is_fiscal then 'Nota de Débito' else 'Nota de débito interna' end
             end || coalesce(' ' || i.letter, '') || ' '
               || lpad(i.punto_venta::text, 4, '0') || '-'
               || coalesce(lpad(i.numero::text, 8, '0'), 's/n') as label,
             coalesce(cl.display_name, cl.legal_name) as counterparty
        from public.invoices i
        join public.invoicing_channels c on c.id = i.channel_id
        join public.clients cl on cl.id = i.client_id
       where g.doc_type = 'invoice' and i.id = g.doc_id
      union all
      select null, p.fecha,
             case p.kind
               when 'factura' then case when c.is_fiscal then 'Factura' else 'Remito interno' end
               when 'nc' then case when c.is_fiscal then 'Nota de Crédito' else 'Nota de crédito interna' end
               else case when c.is_fiscal then 'Nota de Débito' else 'Nota de débito interna' end
             end || coalesce(' ' || p.letter, '') || ' '
               || lpad(p.punto_venta::text, 4, '0') || '-' || lpad(p.numero::text, 8, '0'),
             coalesce(s.display_name, s.legal_name)
        from public.purchase_invoices p
        join public.invoicing_channels c on c.id = p.channel_id
        join public.suppliers s on s.id = p.supplier_id
       where g.doc_type = 'purchase_invoice' and p.id = g.doc_id
      union all
      select null, r.receipt_date,
             'Recibo ' || lpad(r.punto_venta::text, 4, '0') || '-' || lpad(r.numero::text, 8, '0'),
             coalesce(cl.display_name, cl.legal_name)
        from public.receipts r
        join public.clients cl on cl.id = r.client_id
       where g.doc_type = 'receipt' and r.id = g.doc_id
      union all
      select null, po.payment_date,
             'Orden de pago ' || lpad(po.punto_venta::text, 4, '0') || '-' || lpad(po.numero::text, 8, '0'),
             coalesce(s.display_name, s.legal_name)
        from public.payment_orders po
        join public.suppliers s on s.id = po.supplier_id
       where g.doc_type = 'payment_order' and po.id = g.doc_id
      union all
      select pp.kind, make_date(pp.year, pp.month, 1),
             'Planilla de sueldos ' || lpad(pp.month::text, 2, '0') || '/' || pp.year, null
        from public.payroll_periods pp
       where g.doc_type = 'payroll' and pp.id = g.doc_id
      union all
      -- A disbursement is named and dated as such; an installment keeps the
      -- loan's label.
      select null,
             case when g.bucket = 'loan_disbursements' then dt.transaction_date
                  else lo.first_due_date end,
             case when g.bucket = 'loan_disbursements' then 'Desembolso: ' else 'Préstamo: ' end
               || lo.description,
             lo.lender
        from public.loans lo
        left join public.transactions dt on dt.id = lo.disbursement_transaction_id
       where g.doc_type = 'loan' and lo.id = g.doc_id
      union all
      select null, null, 'Cuenta del empleado', e.legal_name
        from public.employees e
       where g.doc_type = 'employee' and e.id = g.doc_id
      union all
      select null, ch.due_date, 'Cheque ' || ch.check_number, ch.drawer_name
        from public.checks ch
       where g.doc_type = 'check' and ch.id = g.doc_id
      union all
      select null, ic.due_date, 'Cheque propio ' || ic.check_number, ic.beneficiary_name
        from public.issued_checks ic
       where g.doc_type = 'issued_check' and ic.id = g.doc_id
      union all
      select null, t.transaction_date, coalesce(nullif(t.description, ''), 'Movimiento de caja'), a.name
        from public.transactions t
        join public.accounts a on a.id = t.account_id
       where g.doc_type = 'transaction' and t.id = g.doc_id
      union all
      select null, je.entry_date, je.description, null
        from public.journal_entries je
       where g.doc_type = 'journal_entry' and je.id = g.doc_id
    ) lab on true
   -- A total order, so the caller can read it page by page.
   order by g.month, abs(g.amount) desc, g.doc_type, g.doc_id, g.bucket, g.subbucket,
            g.channel_side, g.chart_account_id, g.cost_center_id;
end;
$$;

comment on function public.get_management_pnl_documents(date, date, text, text[]) is
  'Resultado de gestión (uso interno): los documentos detrás de cada cifra. Mismas filas que get_management_pnl, nominales.';

revoke all on function public.get_management_pnl_documents(date, date, text, text[]) from public, anon, authenticated;
grant execute on function public.get_management_pnl_documents(date, date, text, text[]) to service_role;
