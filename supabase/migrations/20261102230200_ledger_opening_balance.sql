SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Roadmap 0.11: the libro mayor of a date range starts from the account's
-- balance before that range.
--
-- get_ledger summed the running balance from 0 at p_date_from, so the
-- "Saldo" column of a filtered ledger was the movement of the range, not the
-- account's balance. Now running starts at the opening (Σ debit − Σ credit of
-- the lines before p_date_from), and get_ledger_opening returns that opening
-- on its own, for the "Saldo anterior" line and for a range without
-- movements. Both stay security invoker: they read what the caller's RLS
-- shows, like before.

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
  select coalesce(sum(jel.debit - jel.credit), 0)
    from public.journal_entry_lines jel
    join public.journal_entries je on je.id = jel.journal_entry_id
   where jel.chart_of_accounts_id = p_account_id
     and p_date_from is not null
     and je.entry_date < p_date_from;
$$;

comment on function public.get_ledger_opening(uuid, date) is
  'Saldo de una cuenta antes de p_date_from (Σ debe − Σ haber); 0 sin fecha desde.';

revoke all on function public.get_ledger_opening(uuid, date) from public, anon;
grant execute on function public.get_ledger_opening(uuid, date) to authenticated, service_role;

create or replace function public.get_ledger(
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
  running        numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with movs as (
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
      jel.description  as line_desc
    from public.journal_entry_lines jel
    join public.journal_entries     je on je.id = jel.journal_entry_id
   where jel.chart_of_accounts_id = p_account_id
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
                                      rows between unbounded preceding and current row) as running
  from movs m
  cross join opening o
  order by m.entry_date asc, m.entry_id asc, m.line_id asc;
$$;

comment on function public.get_ledger(uuid, date, date) is
  'Libro Mayor: asientos de una cuenta con saldo running desde el saldo anterior a p_date_from (Σ debe − Σ haber acumulado).';

revoke all on function public.get_ledger(uuid, date, date) from public, anon;
grant execute on function public.get_ledger(uuid, date, date) to authenticated, service_role;
