SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- reopenAccountingPeriodAction deleted the closed period and then, in a
-- second call, posted the entries that waited for it
-- (post_pending_journals). When the second call failed the period stayed
-- open with its entries unposted, and nothing posted them later: the action
-- is post_pending_journals' only caller and reopening needs a closed period.
-- It also posted at most 50 (the function's default limit).
--
-- reopen_accounting_period does both in one transaction: a failed post leaves
-- the period closed, so reopening it again retries. Per-entry failures are
-- still caught inside post_pending_journals and stay pending with their
-- error code, as before.
--
-- Rollback: older code does not call it; dropping it is safe.

-- Returns post_pending_journals' summary, or null when the period was not
-- closed (then nothing changes). service_role only: the action gates with
-- canManageClosedPeriods (owner/admin).
create or replace function public.reopen_accounting_period(p_period text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.accounting_closed_periods where period = p_period;
  if not found then
    return null;
  end if;
  -- Every entry of the period, not the default batch of 50.
  return public.post_pending_journals(p_period, null);
end;
$$;

revoke all on function public.reopen_accounting_period(text) from public, anon, authenticated;
grant execute on function public.reopen_accounting_period(text) to service_role;
