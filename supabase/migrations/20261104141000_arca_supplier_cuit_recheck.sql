SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A supplier's CUIT is part of a received voucher's key: when it changes,
-- the vouchers linked to that supplier's purchases under the old CUIT go
-- back to pending, and the pending ones issued under the new CUIT are
-- linked (link_received_vouchers checks number, amounts and one voucher per
-- purchase). Refusing a CUIT change on closed periods is not this trigger's
-- job.

create or replace function public.suppliers_recheck_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  update public.arca_received_vouchers v
     set status = 'pending_review',
         purchase_invoice_id = null,
         reviewed_at = null
    from public.purchase_invoices p
   where p.id = v.purchase_invoice_id
     and p.supplier_id = new.id
     and v.status = 'confirmed'
     and v.issuer_cuit is distinct from new.cuit;

  select array_agg(v.id) into v_ids
    from public.arca_received_vouchers v
   where v.issuer_cuit = new.cuit
     and v.status in ('pending_review', 'discarded');
  if v_ids is not null then
    perform public.link_received_vouchers(v_ids);
  end if;
  return null;
end;
$$;

revoke all on function public.suppliers_recheck_received() from public, anon, authenticated;

create trigger suppliers_recheck_received
  after update of cuit on public.suppliers
  for each row
  when (old.cuit is distinct from new.cuit)
  execute function public.suppliers_recheck_received();
