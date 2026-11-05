SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W12 · S2 F3: payroll_periods.posts_employee_accounts is the
-- database's alone.
--
-- RLS "hr can insert periods" / "hr can update periods" let owner, admin and
-- finance write every column. A PATCH of posts_employee_accounts = false on a
-- draft period (or an INSERT with it false) made the close skip the deudas
-- movements (payroll_period_sync_account_discounts), so the debt plans kept
-- their remaining and the next periods discounted the same debt again. Setting
-- it true on a period closed before the employee accounts credited, on a
-- reopen and close, deudas that were settled outside the account.
--
-- Writers, latest definitions:
--   * the column default (true) on every INSERT: seed_payroll_period and
--     seed_sac_period (20261103050100), called by the seed actions in
--     features/hr/actions/payroll-actions.ts. None names the column.
--   * the one-off backfill in 20261103060100 (closed periods → false), which
--     runs before this guard.
--   * the app never writes it (features/hr/payroll-schema.ts drops it from
--     its types).
--
-- Same enforce_payroll_period_immutability as 20261104190100, plus, for
-- payroll_periods:
--   * INSERT: a value other than the default (true) is refused;
--   * UPDATE: a change of the column is refused;
-- both unless the caller is service_role (no service writer today; a future
-- backfill migration sets request.jwt.claims to that role first). The
-- trigger now also fires BEFORE INSERT on payroll_periods; the other
-- branches only run on UPDATE, as before.
--
-- Existing rows are not touched. Rollback: older code never writes the
-- column, so it still works.

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
    if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
       and ((tg_op = 'INSERT' and new.posts_employee_accounts is distinct from true)
            or (tg_op = 'UPDATE'
                and new.posts_employee_accounts is distinct from old.posts_employee_accounts)) then
      raise exception
        'Si una liquidación escribe las deudas en la cuenta del empleado lo define el sistema.'
        using errcode = '42501', hint = 'jouve_guard';
    end if;
    if tg_op = 'INSERT' then
      return new;
    end if;
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

create trigger payroll_periods_enforce_immutability_insert
  before insert on public.payroll_periods
  for each row execute function public.enforce_payroll_period_immutability();
