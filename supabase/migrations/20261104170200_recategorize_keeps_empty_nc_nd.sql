SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W10 · S3 F1: «Recategorizar» an NC/ND with an origin to «Sin
-- cuenta (Compras)» or «Sin centro de costo» saves the empty value. Since
-- 20261104160200 the inherit trigger also fires on an update of account_id
-- and cost_center_id, so it refilled the origin's value over the empty one
-- recategorize_expense had just set: the row and the re-posted entry kept the
-- origin's center while the answer and the audit said "null".
--
-- Same function as 20261104160200 (its latest definition), plus one early
-- exit: an update made by recategorize_expense (seen in the call stack,
-- pg_context, as guard_document_header does) is left as is. That function
-- sets both fields on purpose, on the NC/ND itself or on the NC/ND that
-- follow their factura, and never changes the origin or the kind. The edit
-- form's inheritance is unchanged: «La/El del comprobante de origen» still
-- takes the origin's value.
--
-- Existing rows are not backfilled. Rollback: older code calls the same RPC;
-- the older trigger refills, as before.

create or replace function public.purchase_nc_nd_inherit_account()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_cost_center_id uuid;
  v_old_account_id uuid;
  v_old_cost_center_id uuid;
  v_origin_changed boolean;
  v_stack text;
begin
  if new.kind not in ('nc', 'nd') or new.invoice_origin_id is null then
    return new;
  end if;

  -- recategorize_expense chose these values, an empty one included.
  if tg_op = 'UPDATE' then
    get diagnostics v_stack = pg_context;
    if v_stack ~ 'function (public\.)?recategorize_expense\(' then
      return new;
    end if;
  end if;

  v_origin_changed := tg_op = 'INSERT'
    or new.invoice_origin_id is distinct from old.invoice_origin_id;

  if not v_origin_changed
     and new.account_id is not null and new.cost_center_id is not null then
    return new;
  end if;

  select o.account_id, o.cost_center_id
    into v_account_id, v_cost_center_id
    from public.purchase_invoices o
   where o.id = new.invoice_origin_id;

  if tg_op = 'UPDATE' and v_origin_changed then
    -- What the NC/ND inherited from its old origin follows the new one.
    if old.invoice_origin_id is not null then
      select o.account_id, o.cost_center_id
        into v_old_account_id, v_old_cost_center_id
        from public.purchase_invoices o
       where o.id = old.invoice_origin_id;
    end if;
    if new.account_id is not distinct from old.account_id
       and old.account_id is not distinct from v_old_account_id then
      new.account_id := null;
    end if;
    if new.cost_center_id is not distinct from old.cost_center_id
       and old.cost_center_id is not distinct from v_old_cost_center_id then
      new.cost_center_id := null;
    end if;
  elsif tg_op = 'UPDATE'
        and ((old.account_id is null and new.account_id is null and v_account_id is not null)
          or (old.cost_center_id is null and new.cost_center_id is null and v_cost_center_id is not null))
        and exists (
          select 1
            from public.accounting_closed_periods cp
           where cp.period = to_char(new.fecha, 'YYYY-MM')
              or cp.period in (select je.accrual_period
                                 from public.journal_entries je
                                where je.source_table = 'purchase_invoices'
                                  and je.source_id = new.id)
        ) then
    -- A field that was already empty stays so in a closed period.
    if old.account_id is null then
      v_account_id := null;
    end if;
    if old.cost_center_id is null then
      v_cost_center_id := null;
    end if;
  end if;

  new.account_id := coalesce(new.account_id, v_account_id);
  new.cost_center_id := coalesce(new.cost_center_id, v_cost_center_id);
  return new;
end;
$$;

comment on function public.purchase_nc_nd_inherit_account() is
  'Una NC/ND de compra sin cuenta de gasto o sin centro de costo toma los de su comprobante de origen, cada uno por separado, al cargarla y al editarla (salvo uno que ya estaba vacío en un período cerrado). Si cambia el origen, lo que había heredado del anterior pasa al nuevo. Lo que fija recategorize_expense (vacío incluido) se respeta.';

revoke all on function public.purchase_nc_nd_inherit_account()
  from public, anon, authenticated;
