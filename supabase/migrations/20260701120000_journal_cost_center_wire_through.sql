-- Cost-center wire-through: make cost centers reportable end-to-end.
--
-- Until now cost_center_id was written on the source rows (purchase_invoices,
-- recurring_payments, AI document mapping) but never reached journal_entries
-- (create_journal_entry has no cost-center param), so journal_entries.cost_center_id
-- was always NULL and get_account_balances could not filter by cost center.
--
-- Rather than touch the ~7 SECURITY DEFINER emitters that call create_journal_entry,
-- a BEFORE INSERT trigger on journal_entries copies cost_center_id from the source
-- row. This is localized and backward-compatible: emitters are untouched.

set row_security = off;

-- 1) Populate journal_entries.cost_center_id from the source row on insert.
create or replace function public.set_journal_cost_center()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cc uuid;
begin
  if new.cost_center_id is null and new.source_id is not null then
    case new.source_table
      when 'transactions' then
        select cost_center_id into v_cc from public.transactions where id = new.source_id;
      when 'invoices' then
        select cost_center_id into v_cc from public.invoices where id = new.source_id;
      when 'purchase_invoices' then
        select cost_center_id into v_cc from public.purchase_invoices where id = new.source_id;
      when 'payment_orders' then
        select cost_center_id into v_cc from public.payment_orders where id = new.source_id;
      when 'receipts' then
        select cost_center_id into v_cc from public.receipts where id = new.source_id;
      else
        v_cc := null;
    end case;
    new.cost_center_id := v_cc;
  end if;
  return new;
end;
$$;

drop trigger if exists journal_entries_set_cost_center on public.journal_entries;
create trigger journal_entries_set_cost_center
  before insert on public.journal_entries
  for each row execute function public.set_journal_cost_center();

-- 2) Backfill existing entries from their source rows.
update public.journal_entries je set cost_center_id = t.cost_center_id
  from public.transactions t
  where je.source_table = 'transactions' and je.source_id = t.id
    and je.cost_center_id is null and t.cost_center_id is not null;
update public.journal_entries je set cost_center_id = i.cost_center_id
  from public.invoices i
  where je.source_table = 'invoices' and je.source_id = i.id
    and je.cost_center_id is null and i.cost_center_id is not null;
update public.journal_entries je set cost_center_id = pi.cost_center_id
  from public.purchase_invoices pi
  where je.source_table = 'purchase_invoices' and je.source_id = pi.id
    and je.cost_center_id is null and pi.cost_center_id is not null;
update public.journal_entries je set cost_center_id = po.cost_center_id
  from public.payment_orders po
  where je.source_table = 'payment_orders' and je.source_id = po.id
    and je.cost_center_id is null and po.cost_center_id is not null;
update public.journal_entries je set cost_center_id = r.cost_center_id
  from public.receipts r
  where je.source_table = 'receipts' and je.source_id = r.id
    and je.cost_center_id is null and r.cost_center_id is not null;

-- 3) get_account_balances gains an optional cost-center filter. Drop the old
--    2-arg signature first to avoid overload ambiguity, then recreate with the
--    trailing optional param (existing 2-arg callers keep working).
drop function if exists public.get_account_balances(text, text);

create or replace function public.get_account_balances(
  p_period_end text,
  p_period_start text default null,
  p_cost_center_id uuid default null
)
returns table(
  account_id uuid,
  account_code text,
  account_name text,
  account_type coa_account_type,
  eerr_category text,
  total_debit numeric,
  total_credit numeric,
  balance numeric
)
language sql
stable
set search_path to 'public'
as $$
  select
    coa.id, coa.code, coa.name, coa.account_type, coa.eerr_category,
    coalesce(sum(jel.debit), 0)  as total_debit,
    coalesce(sum(jel.credit), 0) as total_credit,
    coalesce(sum(jel.debit - jel.credit), 0) as balance
  from public.chart_of_accounts coa
  left join public.journal_entry_lines jel on jel.chart_of_accounts_id = coa.id
  left join public.journal_entries je       on je.id = jel.journal_entry_id
     and je.accrual_period <= p_period_end
     and (p_period_start is null or je.accrual_period >= p_period_start)
     and (p_cost_center_id is null or je.cost_center_id = p_cost_center_id)
   where coa.is_active = true
   group by coa.id, coa.code, coa.name, coa.account_type, coa.eerr_category
   having coalesce(sum(jel.debit), 0) <> 0 or coalesce(sum(jel.credit), 0) <> 0
   order by coa.code;
$$;

set row_security = on;
