-- Audit remediation T3 — get_account_balances: make the period and cost-center
-- filters actually apply.
--
-- Bug: the accrual_period / cost_center_id predicates lived in the ON clause of a
-- LEFT JOIN to journal_entries, but the sums aggregate journal_entry_lines
-- columns from the first join. A failing predicate only nulled the unused je
-- columns; the jel row (and its debit/credit) was retained. Result: every
-- Balance/EERR showed all-time figures regardless of the period selector, and
-- the cost-center filter was inert.
--
-- Fix: INNER-join journal_entries to journal_entry_lines WITH the filters, then
-- LEFT-join that to chart_of_accounts. Only in-range lines survive; accounts with
-- no in-range movement fall out via the HAVING (sum = 0). Also drop the
-- `is_active` filter so deactivated accounts that still carry movements are
-- included (otherwise Σdebe != Σhaber once an account with history is disabled).

set row_security = off;

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
  left join (
    public.journal_entry_lines jel
    join public.journal_entries je
      on je.id = jel.journal_entry_id
     and je.accrual_period <= p_period_end
     and (p_period_start is null or je.accrual_period >= p_period_start)
     and (p_cost_center_id is null or je.cost_center_id = p_cost_center_id)
  ) on jel.chart_of_accounts_id = coa.id
   group by coa.id, coa.code, coa.name, coa.account_type, coa.eerr_category
   having coalesce(sum(jel.debit), 0) <> 0 or coalesce(sum(jel.credit), 0) <> 0
   order by coa.code;
$$;

set row_security = on;
