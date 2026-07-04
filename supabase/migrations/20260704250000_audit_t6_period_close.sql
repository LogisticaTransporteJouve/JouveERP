-- Audit remediation T6 — accounting period close/lock.
--
-- There was no concept of a closed period: posted journal entries stayed
-- editable/deletable and manual entries could be backdated into an already
-- presented Libro IVA month with no trace. This adds a closed-periods registry
-- and a guard that blocks any journal write whose accrual_period is closed
-- (INSERT/UPDATE/DELETE, including the auto-posting triggers). Closing a period
-- is owner/admin only; the write path is the service client (see the action).

set row_security = off;

create table if not exists public.accounting_closed_periods (
  period     text primary key
             check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  closed_at  timestamptz not null default now(),
  closed_by  uuid references auth.users(id) on delete set null,
  note       text
);

alter table public.accounting_closed_periods enable row level security;

-- Read: accounting roles. Writes go through the service client only (no
-- authenticated write policy), gated by the owner/admin action.
drop policy if exists "accounting roles read closed periods" on public.accounting_closed_periods;
create policy "accounting roles read closed periods"
  on public.accounting_closed_periods for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

-- Guard: block any journal write in a closed period.
create or replace function public.guard_journal_period_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period text := coalesce(new.accrual_period, old.accrual_period);
begin
  if exists (select 1 from public.accounting_closed_periods where period = v_period) then
    raise exception 'El período contable % está cerrado y no admite movimientos', v_period
      using errcode = '55006';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists guard_journal_period_closed on public.journal_entries;
create trigger guard_journal_period_closed
  before insert or update or delete on public.journal_entries
  for each row execute function public.guard_journal_period_closed();

set row_security = on;
