SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A purchase NC/ND inherits its origin's account and its origin's cost
-- center each on its own. Same trigger and conditions as 20261102230100 (its
-- only definition), except that the center was copied only when the account
-- was empty too: an NC/ND with its own account and «El del comprobante de
-- origen» as center was saved with no center, so its credit fell in «Sin
-- centro» (Gestión) and in no truck's row (Margen por camión).
--
-- Existing NCs/NDs are not backfilled. Rollback: the older code sends the
-- same fields; it only reads the center the trigger now fills.

create or replace function public.purchase_nc_nd_inherit_account()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_cost_center_id uuid;
begin
  if new.kind in ('nc', 'nd')
     and new.invoice_origin_id is not null
     and (new.account_id is null or new.cost_center_id is null)
     and (tg_op = 'INSERT' or new.invoice_origin_id is distinct from old.invoice_origin_id) then
    select o.account_id, o.cost_center_id
      into v_account_id, v_cost_center_id
      from public.purchase_invoices o
     where o.id = new.invoice_origin_id;
    new.account_id := coalesce(new.account_id, v_account_id);
    new.cost_center_id := coalesce(new.cost_center_id, v_cost_center_id);
  end if;
  return new;
end;
$$;

comment on function public.purchase_nc_nd_inherit_account() is
  'Una NC/ND de compra sin cuenta de gasto toma la de su comprobante de origen, y sin centro de costo toma el de su origen, cada uno por separado.';

revoke all on function public.purchase_nc_nd_inherit_account()
  from public, anon, authenticated;
