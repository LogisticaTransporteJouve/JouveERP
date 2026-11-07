SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Statement lines classified by the bank's code.
--
-- 1. bank_statement_codes: per treasury account, what each bank code (and,
--    when one code carries several movements, a text the description
--    contains) is: a tax, a bank fee, a collection, a payment, a transfer, a
--    loan cuota or nothing; with the chart account a tax or fee posts to.
--    Written only through the service role (the app's gated actions).
-- 2. is_bank_tax_account: the tax credits a bank debits (SIRCREB and IIBB
--    perceptions, retentions, Ganancias payments on account).
-- 3. guard_transaction_expense_account: an expense may post to one of those
--    accounts only when create_bank_statement_line_transaction creates it,
--    in pesos and on a fiscal channel; the trigger also fires on a change of
--    channel or currency so such a posting cannot move to interno or USD.
-- 4. 5.4.3 "Impuesto a los débitos y créditos bancarios" (Ley 25.413), a
--    leaf under Gastos financieros, in Gestión as impuestos.
-- 5. management_pnl_lines: in the cash view a tax credit booked from the
--    bank counts as impuestos paid (it has no bucket: an asset).

-- 1. Codes ----------------------------------------------------------------------

create table public.bank_statement_codes (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts (id) on delete cascade,
  bank_code           text not null check (char_length(bank_code) between 1 and 20),
  description_pattern text not null default '' check (char_length(description_pattern) <= 80),
  kind                text not null check (kind in (
                        'tax', 'bank_fee', 'receipt', 'payment', 'transfer', 'loan', 'ignore')),
  chart_account_id    uuid references public.chart_of_accounts (id) on delete set null,
  label               text check (char_length(label) <= 120),
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint bank_statement_codes_key unique (account_id, bank_code, description_pattern)
);

comment on table public.bank_statement_codes is
  'Qué es cada código del banco en el extracto de una cuenta (impuesto, gasto bancario, cobro, pago, transferencia, cuota de préstamo o nada) y a qué cuenta contable va.';
comment on column public.bank_statement_codes.description_pattern is
  'Texto que tiene que contener la descripción cuando un mismo código trae movimientos distintos; vacío = todo el código.';

create index bank_statement_codes_chart_account_idx on public.bank_statement_codes (chart_account_id);
create index bank_statement_codes_created_by_idx on public.bank_statement_codes (created_by);

create trigger bank_statement_codes_set_updated_at
  before update on public.bank_statement_codes
  for each row execute function public.set_updated_at();

alter table public.bank_statement_codes enable row level security;

create policy "finance reads bank statement codes"
  on public.bank_statement_codes for select
  to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

revoke all on table public.bank_statement_codes from anon;

-- 2. Tax credits a bank debits ---------------------------------------------------

create function public.is_bank_tax_account(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.chart_of_accounts
     where id = p_account_id
       and is_active
       and system_role in ('percepciones_iibb_pagadas', 'retenciones_pagadas', 'percepciones_ganancias')
  );
$$;

comment on function public.is_bank_tax_account(uuid) is
  'Cuenta de impuesto a favor que el banco debita (SIRCREB y percepciones de IIBB, retenciones, pagos a cuenta de Ganancias).';

revoke all on function public.is_bank_tax_account(uuid) from public, anon, authenticated;

-- 3. Guard -----------------------------------------------------------------------

-- Same as 20261103170000 plus the bank tax credits.
create or replace function public.guard_transaction_expense_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if new.expense_account_id is null then
    return new;
  end if;
  if new.kind <> 'expense'
     or new.invoice_id is not null
     or new.receipt_id is not null
     or new.payment_order_id is not null
     or new.issued_check_id is not null
     or new.rejected_check_id is not null
     or new.manual_check_id is not null
     or new.transfer_pair_id is not null
     or new.is_payroll
     or exists (select 1 from public.payroll_payments where transaction_id = new.id)
     or exists (select 1 from public.loan_installments where transaction_id = new.id)
     or exists (select 1 from public.check_movements where transaction_id = new.id)
     or exists (select 1 from public.account_opening_balances where adjustment_transaction_id = new.id)
     or exists (select 1 from public.employee_account_movements where transaction_id = new.id)
     or exists (select 1 from public.tax_documents where payment_transaction_id = new.id) then
    raise exception 'Solo un egreso manual lleva cuenta de gasto: el de un documento se imputa desde el documento'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if public.is_bank_tax_account(new.expense_account_id) then
    if tg_op = 'INSERT' or new.expense_account_id is distinct from old.expense_account_id then
      get diagnostics v_stack = pg_context;
      if v_stack !~ 'function (public\.)?create_bank_statement_line_transaction\(' then
        raise exception 'Una cuenta de impuesto a favor solo se imputa desde una línea del extracto del banco'
          using errcode = '23514', hint = 'jouve_guard';
      end if;
    end if;
    if new.currency <> 'ARS'
       or not exists (select 1 from public.invoicing_channels c where c.id = new.channel_id and c.is_fiscal) then
      raise exception 'Un impuesto a favor va en pesos y en el canal fiscal'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    return new;
  end if;

  if (tg_op = 'INSERT' or new.expense_account_id is distinct from old.expense_account_id)
     and not public.is_postable_expense_account(new.expense_account_id) then
    raise exception 'La cuenta de gasto debe ser una cuenta hoja de resultado (sin subcuentas) y activa'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_transaction_expense_account() from public, anon, authenticated;

drop trigger transactions_guard_expense_account on public.transactions;
create trigger transactions_guard_expense_account
  before insert or update of expense_account_id, kind, channel_id, currency on public.transactions
  for each row execute function public.guard_transaction_expense_account();

-- 4. Ley 25.413 --------------------------------------------------------------------

insert into public.chart_of_accounts (parent_id, code, name, level, account_type, eerr_category)
select p.id, '5.4.3', 'Impuesto a los débitos y créditos bancarios', 3, p.account_type, p.eerr_category
  from public.chart_of_accounts p
 where p.code = '5.4'
   and not exists (select 1 from public.chart_of_accounts where code = '5.4.3');

insert into public.management_buckets (chart_of_accounts_id, bucket, subbucket)
select a.id, 'operating_cost', 'impuestos'
  from public.chart_of_accounts a
 where a.code = '5.4.3'
   and a.name = 'Impuesto a los débitos y créditos bancarios'
on conflict (chart_of_accounts_id) do nothing;

-- 5. Gestión -----------------------------------------------------------------------

-- Same as 20261104120201 plus the bank tax credits in the cash view.
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

comment on function public.management_pnl_lines(date, date, text) is
  'Resultado de gestión (uso interno) por documento, nominal. Lo suman get_management_pnl y get_management_pnl_documents.';

revoke all on function public.management_pnl_lines(date, date, text) from public, anon, authenticated;
