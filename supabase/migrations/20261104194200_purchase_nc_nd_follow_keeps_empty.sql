SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W12 · S3 F1: «Modificar» a factura's center refilled the empty
-- account of an NC/ND that follows it (and editing its account refilled the
-- empty center). The follow trigger (20261104190201) sets both fields of each
-- linked NC/ND, so purchase_nc_nd_inherit_account fired and filled the one
-- left empty on purpose with the factura's value. «Recategorizar» keeps it
-- empty, as decided in 20261104170200.
--
-- Same function as 20261104170200 (its latest definition); the call-stack
-- early exit now also covers purchase_nc_nd_follow_factura. Like
-- recategorize_expense, that trigger picks both values on purpose and never
-- changes the origin or the kind.
--
-- Existing rows are not backfilled. Rollback: older code writes the same
-- columns; the older function refills, as before.

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

  -- recategorize_expense, or the trigger that makes the NC/ND follow an
  -- edited factura, chose these values, an empty one included.
  if tg_op = 'UPDATE' then
    get diagnostics v_stack = pg_context;
    if v_stack ~ 'function (public\.)?(recategorize_expense|purchase_nc_nd_follow_factura)\(' then
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
  'Una NC/ND de compra sin cuenta de gasto o sin centro de costo toma los de su comprobante de origen, cada uno por separado, al cargarla y al editarla (salvo uno que ya estaba vacío en un período cerrado). Si cambia el origen, lo que había heredado del anterior pasa al nuevo. Lo que fijan recategorize_expense y el seguimiento de la factura editada (purchase_nc_nd_follow_factura), vacío incluido, se respeta.';

revoke all on function public.purchase_nc_nd_inherit_account()
  from public, anon, authenticated;
