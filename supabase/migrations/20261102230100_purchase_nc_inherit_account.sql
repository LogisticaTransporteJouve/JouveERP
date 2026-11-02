SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Roadmap 0.11: a purchase NC/ND posts to the same expense account as the
-- invoice it adjusts.
--
-- build_purchase_invoice_journal_lines books the neto of an NC/ND to the
-- NC/ND's own account_id, or to the 'compras' account when it has none. The
-- manual form sends no account (only a document draft does), so an NC of a
-- factura booked to, say, "Combustibles" reversed "Compras" instead. Now an
-- NC/ND without account takes its origin's account, and its cost center when
-- it has none. An account set on the NC/ND is kept.
--
-- On update it runs only when the origin changes: the edit form re-sends
-- invoice_origin_id on every save, and inheriting then would re-post an old
-- NC/ND (refused in a closed period) when only its notes changed. Existing
-- NCs/NDs are not backfilled.

create function public.purchase_nc_nd_inherit_account()
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
     and new.account_id is null
     and (tg_op = 'INSERT' or new.invoice_origin_id is distinct from old.invoice_origin_id) then
    select o.account_id, o.cost_center_id
      into v_account_id, v_cost_center_id
      from public.purchase_invoices o
     where o.id = new.invoice_origin_id;
    new.account_id := v_account_id;
    new.cost_center_id := coalesce(new.cost_center_id, v_cost_center_id);
  end if;
  return new;
end;
$$;

comment on function public.purchase_nc_nd_inherit_account() is
  'Una NC/ND de compra sin cuenta de gasto toma la cuenta (y el centro de costo si no tiene) de su comprobante de origen.';

revoke all on function public.purchase_nc_nd_inherit_account()
  from public, anon, authenticated;

create trigger purchase_invoices_nc_nd_inherit_account
  before insert or update of invoice_origin_id on public.purchase_invoices
  for each row execute function public.purchase_nc_nd_inherit_account();
