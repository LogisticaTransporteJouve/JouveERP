SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W11 · S4 F1: a closed liquidación is reopened only by owner or
-- admin, and its entries and extras never leave it.
--
-- hr:admin (reopen) is owner/admin in the matrix, but RLS "hr can update
-- periods" lets finance PATCH every column of payroll_periods. A finance
-- session could set a closed period back to draft with its own token: no
-- payroll.period_reopened audit, and payroll_period_sync_account_discounts
-- deleted the period's discounts from the employee accounts. The entry lock
-- read only the NEW period on update, so a PATCH of payroll_entries.period_id
-- (or payroll_entry_extras.entry_id) moved a row of a closed period into a
-- draft one, where it could be edited or deleted.
--
-- Writers, latest definitions:
--   * payroll_periods.status: closePayrollPeriodAction (hr:write, draft →
--     closed) and reopenPayrollPeriodAction (hr:admin, closed → draft), both
--     with the user's client. No SQL function updates a period's status.
--   * payroll_entries.period_id / payroll_entry_extras.entry_id: set on
--     insert (seed/fill/SAC RPCs, applyFinalSettlementAction's upsert on
--     (period_id, employee_id), the extras actions). No writer changes them
--     afterwards; the draft-only syncs (embargo, deudas, salary raise) update
--     other columns.
--
-- Same enforce_payroll_period_immutability as 20261102170000, plus:
--   * payroll_periods: leaving 'closed' needs owner/admin (service_role,
--     which runs no reopen today, passes);
--   * payroll_entries / payroll_entry_extras: an UPDATE that changes the link
--     also checks the OLD period;
--   * hint jouve_guard on every raise, DEFINER with search_path = '' so the
--     period reads do not depend on the caller's RLS.
--
-- Existing rows are not touched. Rollback: older code reopens only through
-- the hr:admin action and never moves an entry or extra, so it still works.

create or replace function public.enforce_payroll_period_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_table_name = 'payroll_periods' then
    if old.status = 'closed' and new.status is distinct from 'closed'
       and coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
       and not public.user_has_role(array['owner', 'admin']) then
      raise exception
        'Solo un owner o un admin pueden reabrir una liquidación cerrada.'
        using errcode = '42501', hint = 'jouve_guard';
    end if;
    if old.status = 'closed' and new.status = 'closed' then
      if new.year is distinct from old.year
         or new.month is distinct from old.month then
        raise exception
          'Período cerrado (id=%): año/mes son inmutables', old.id
          using errcode = '23514', hint = 'jouve_guard';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'payroll_entries' then
    select status into v_status
    from public.payroll_periods
    where id = coalesce(new.period_id, old.period_id);
    if v_status = 'closed' then
      raise exception
        'Período cerrado: no se pueden modificar entries (period_id=%)',
        coalesce(new.period_id, old.period_id)
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    if tg_op = 'UPDATE' and new.period_id is distinct from old.period_id then
      select status into v_status
      from public.payroll_periods
      where id = old.period_id;
      if v_status = 'closed' then
        raise exception
          'Período cerrado: sus entries no se pasan a otro período (period_id=%)',
          old.period_id
          using errcode = '23514', hint = 'jouve_guard';
      end if;
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_table_name = 'payroll_entry_extras' then
    select pp.status into v_status
    from public.payroll_entries pe
    join public.payroll_periods pp on pp.id = pe.period_id
    where pe.id = coalesce(new.entry_id, old.entry_id);
    if v_status = 'closed' then
      raise exception
        'Período cerrado: no se pueden modificar extras (entry_id=%)',
        coalesce(new.entry_id, old.entry_id)
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    if tg_op = 'UPDATE' and new.entry_id is distinct from old.entry_id then
      select pp.status into v_status
      from public.payroll_entries pe
      join public.payroll_periods pp on pp.id = pe.period_id
      where pe.id = old.entry_id;
      if v_status = 'closed' then
        raise exception
          'Período cerrado: sus extras no se pasan a otra entry (entry_id=%)',
          old.entry_id
          using errcode = '23514', hint = 'jouve_guard';
      end if;
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_payroll_period_immutability() from public, anon, authenticated;
