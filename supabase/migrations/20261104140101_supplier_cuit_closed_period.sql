SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W7 · S1 F2: libro_iva_compras and its TXT read the supplier's CUIT
-- live, so changing it rewrote the CUIT column of a closed period's
-- «Definitivo» book. A CUIT change is refused while the supplier has a fiscal
-- received purchase in a closed period (purchase_items_period_closed, the
-- predicate the purchase guards use). Reopening the period allows it again.
--
-- Rollback: older code writes suppliers the same way; it gets this message
-- through mapDbGuardError, as for the other supplier guards.

create or replace function public.guard_supplier_cuit_closed_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cuit is distinct from old.cuit
     and exists (
       select 1
         from public.purchase_invoices p
        where p.supplier_id = old.id
          and public.purchase_items_period_closed(p.id)
     ) then
    raise exception 'El proveedor tiene compras en un período contable cerrado: su CUIT figura en el Libro IVA Compras y no se puede cambiar.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_supplier_cuit_closed_period() from public, anon, authenticated;

create trigger suppliers_guard_cuit_closed_period
  before update of cuit on public.suppliers
  for each row execute function public.guard_supplier_cuit_closed_period();
