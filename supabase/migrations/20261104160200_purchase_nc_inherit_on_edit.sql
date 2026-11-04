SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W9 · S3 F1 / S6 F1 / S7 F1: an edited purchase NC/ND follows its
-- origin, as «La/El del comprobante de origen» promises. Same function as
-- 20261104150200 (insert unchanged), plus two update cases:
--
-- - The origin changes: an account or center that is empty, or that still
--   holds the old origin's value and this save did not change, takes the new
--   origin's. Before, only an empty field was filled, so an NC moved from
--   factura X to factura Y kept X's account and center.
-- - The origin stays: an empty account or center takes the origin's. Before,
--   picking the empty option in «Modificar» saved no account (the neto
--   reversed «Compras») and no center. A field that was already empty is
--   left alone while the NC/ND's period (its date or a live entry) is
--   closed: re-posting it there is refused, and a notes-only save must still
--   pass (the reason 20261102230100 inherited on a new origin only).
--
-- The trigger now also fires on account_id, cost_center_id and kind; the
-- edit action and recategorize_expense set those. recategorize_expense
-- updates the origin before its NC/ND, so an NC/ND it empties takes the
-- origin's new value.
--
-- Existing rows are not backfilled. Rollback: the older code sends the same
-- fields; the older function only fills fewer of them.

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
begin
  if new.kind not in ('nc', 'nd') or new.invoice_origin_id is null then
    return new;
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
  'Una NC/ND de compra sin cuenta de gasto o sin centro de costo toma los de su comprobante de origen, cada uno por separado, al cargarla y al editarla (salvo uno que ya estaba vacío en un período cerrado). Si cambia el origen, lo que había heredado del anterior pasa al nuevo.';

revoke all on function public.purchase_nc_nd_inherit_account()
  from public, anon, authenticated;

drop trigger purchase_invoices_nc_nd_inherit_account on public.purchase_invoices;
create trigger purchase_invoices_nc_nd_inherit_account
  before insert or update of invoice_origin_id, account_id, cost_center_id, kind
  on public.purchase_invoices
  for each row execute function public.purchase_nc_nd_inherit_account();
