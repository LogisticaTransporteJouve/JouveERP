SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- An embargo typed by hand on a draft planilla survives garnishment writes
-- (follow-up of 20261103050000_payroll_receipt_net_garnishments).
--
-- employee_garnishment_refresh_entries rewrote embargo on every draft entry
-- of the employee, so loading a garnishment active only from December zeroed
-- the embargo typed by hand on November. Same pattern as deudas_override:
--
--   1. payroll_entries.embargo_override: a hand edit of embargo (a direct
--      UPDATE, not a refresh fired from a garnishment) sets it and keeps the
--      typed amount; setting it back to false recomputes embargo from the
--      garnishments (0 without one).
--   2. payroll_entry_apply_garnishment skips an overridden entry on salary or
--      receipt changes; employee_garnishment_refresh_entries skips it too.
--   3. Backfill: a draft entry whose embargo differs from what its
--      garnishments give was typed by hand → embargo_override = true.
--
-- Rollback: older code ignores the column; a hand edit from it is still
-- marked as an override by the trigger.

-- 1. Column -------------------------------------------------------------------------

alter table public.payroll_entries
  add column embargo_override boolean not null default false;

comment on column public.payroll_entries.embargo_override is
  'true = el embargo se cargó a mano en este período y los embargos del empleado no lo pisan; false = lo calcula la base desde los embargos vigentes.';

-- 2. Triggers -----------------------------------------------------------------------

create or replace function public.payroll_entry_apply_garnishment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_amount numeric;
begin
  if tg_op = 'UPDATE' then
    -- Typed by a user (not by a refresh fired from a garnishment).
    if pg_trigger_depth() = 1
       and new.embargo is distinct from old.embargo
       and new.embargo_override is not distinct from old.embargo_override then
      new.embargo_override := true;
      return new;
    end if;
    if old.embargo_override and not new.embargo_override then
      new.embargo := coalesce(public.payroll_garnishment_amount(
        new.employee_id, new.period_id, coalesce(new.recibo_neto, new.sueldo_neto)
      ), 0);
      return new;
    end if;
    if new.embargo_override
       or (new.sueldo_neto is not distinct from old.sueldo_neto
           and new.recibo_neto is not distinct from old.recibo_neto) then
      return new;
    end if;
  elsif new.embargo_override then
    return new;
  end if;

  v_amount := public.payroll_garnishment_amount(
    new.employee_id, new.period_id, coalesce(new.recibo_neto, new.sueldo_neto)
  );
  if v_amount is not null then
    new.embargo := v_amount;
  end if;
  return new;
end;
$$;

revoke all on function public.payroll_entry_apply_garnishment() from public, anon;

drop trigger payroll_entries_apply_garnishment on public.payroll_entries;
create trigger payroll_entries_apply_garnishment
  before insert or update of sueldo_neto, recibo_neto, embargo, embargo_override
  on public.payroll_entries
  for each row execute function public.payroll_entry_apply_garnishment();

create or replace function public.employee_garnishment_refresh_entries()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_employee uuid := coalesce(new.employee_id, old.employee_id);
begin
  update public.payroll_entries pe
     set embargo = coalesce(
           public.payroll_garnishment_amount(pe.employee_id, pe.period_id, coalesce(pe.recibo_neto, pe.sueldo_neto)),
           0)
    from public.payroll_periods pp
   where pp.id = pe.period_id
     and pp.status = 'draft'
     and not pe.embargo_override
     and pe.employee_id in (v_employee, old.employee_id);
  return null;
end;
$$;

revoke all on function public.employee_garnishment_refresh_entries() from public, anon;

-- 3. Backfill -----------------------------------------------------------------------

update public.payroll_entries pe
   set embargo_override = true
  from public.payroll_periods pp
 where pp.id = pe.period_id
   and pp.status = 'draft'
   and pe.embargo is distinct from coalesce(
         public.payroll_garnishment_amount(pe.employee_id, pe.period_id, coalesce(pe.recibo_neto, pe.sueldo_neto)),
         0);
