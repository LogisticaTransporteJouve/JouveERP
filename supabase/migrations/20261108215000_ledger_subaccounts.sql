SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- The general ledger of a grouping account (1.1.1 Caja y bancos) is the sum
-- of its subaccounts: lines post only to accounts without children, so the
-- ledger and its opening balance take the account and everything under it.
-- Each line says which account it posted to.
--
-- Rollback: older code reads the same columns plus two it ignores; for an
-- account without children the result is the same as before.

create or replace function public.get_ledger_opening(
  p_account_id uuid,
  p_date_from  date
)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive tree as (
    select c.id from public.chart_of_accounts c where c.id = p_account_id
    union all
    select c.id from public.chart_of_accounts c join tree t on c.parent_id = t.id
  )
  select coalesce(sum(jel.debit - jel.credit), 0)
    from public.journal_entry_lines jel
    join public.journal_entries je on je.id = jel.journal_entry_id
   where jel.chart_of_accounts_id in (select id from tree)
     and p_date_from is not null
     and je.entry_date < p_date_from;
$$;
comment on function public.get_ledger_opening(uuid, date) is
  'Saldo de una cuenta y sus subcuentas antes de p_date_from (Σ debe − Σ haber); 0 sin fecha desde.';

-- Two columns join the result, which create or replace can't do. Older code
-- asks PostgREST for the function by name and ignores the new columns.
-- squawk-ignore ban-drop-function
drop function public.get_ledger(uuid, date, date);

create function public.get_ledger(
  p_account_id uuid,
  p_date_from  date default null,
  p_date_to    date default null
)
returns table (
  entry_id       uuid,
  line_id        uuid,
  entry_date     date,
  accrual_period text,
  description    text,
  source_table   text,
  source_id      uuid,
  channel_id     text,
  is_reversal    boolean,
  debit          numeric,
  credit         numeric,
  line_desc      text,
  running        numeric,
  account_code   text,
  account_name   text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive tree as (
    select c.id from public.chart_of_accounts c where c.id = p_account_id
    union all
    select c.id from public.chart_of_accounts c join tree t on c.parent_id = t.id
  ),
  movs as (
    select
      je.id            as entry_id,
      jel.id           as line_id,
      je.entry_date,
      je.accrual_period,
      je.description,
      je.source_table,
      je.source_id,
      je.channel_id,
      je.is_reversal,
      jel.debit,
      jel.credit,
      jel.description  as line_desc,
      coa.code         as account_code,
      coa.name         as account_name
    from public.journal_entry_lines jel
    join public.journal_entries     je  on je.id = jel.journal_entry_id
    join public.chart_of_accounts   coa on coa.id = jel.chart_of_accounts_id
   where jel.chart_of_accounts_id in (select id from tree)
     and (p_date_from is null or je.entry_date >= p_date_from)
     and (p_date_to   is null or je.entry_date <= p_date_to)
  ),
  opening as (
    select public.get_ledger_opening(p_account_id, p_date_from) as balance
  )
  select
    m.entry_id, m.line_id, m.entry_date, m.accrual_period, m.description,
    m.source_table, m.source_id, m.channel_id, m.is_reversal,
    m.debit, m.credit, m.line_desc,
    o.balance
      + sum(m.debit - m.credit) over (order by m.entry_date asc, m.entry_id asc, m.line_id asc
                                      rows between unbounded preceding and current row) as running,
    m.account_code, m.account_name
  from movs m
  cross join opening o
  order by m.entry_date asc, m.entry_id asc, m.line_id asc;
$$;
comment on function public.get_ledger(uuid, date, date) is
  'Libro mayor de una cuenta y sus subcuentas: líneas con saldo acumulado desde el saldo anterior a p_date_from.';

revoke all on function public.get_ledger(uuid, date, date) from public, anon;
grant execute on function public.get_ledger(uuid, date, date) to authenticated, service_role;
