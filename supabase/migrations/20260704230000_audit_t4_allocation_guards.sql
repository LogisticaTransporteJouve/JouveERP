-- Audit remediation T4 — prevent over-application and cross-counterparty
-- allocation of receipts and payment orders.
--
-- create_receipt / create_payment_order computed the outstanding amount app-side
-- (read-then-write) and never verified, in the DB, that the allocated invoice
-- belongs to the receipt's client / PO's supplier, nor that cumulative applied
-- stays within the invoice total. Two concurrent receipts for the same client
-- could each pass their app-side snapshot and apply the invoice to 200%; because
-- aging filters open_amount > 0, the over-applied invoice then silently vanishes.
--
-- These BEFORE triggers enforce both invariants at the DB regardless of the write
-- path. The FOR UPDATE on the invoice serializes concurrent allocations to the
-- same invoice, closing the race. A 0.01 tolerance absorbs rounding.

set row_security = off;

-- Receipts -> invoices ---------------------------------------------------------
create or replace function public.guard_receipt_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client   uuid;
  v_total    numeric;
  v_receipt_client uuid;
  v_sum      numeric;
begin
  select client_id, imp_total into v_client, v_total
    from public.invoices where id = new.invoice_id for update;
  if not found then
    raise exception 'Comprobante % no existe', new.invoice_id using errcode = '23503';
  end if;

  select client_id into v_receipt_client from public.receipts where id = new.receipt_id;
  if v_receipt_client is distinct from v_client then
    raise exception 'El comprobante no pertenece al cliente del recibo'
      using errcode = '23514';
  end if;

  select coalesce(sum(ra.amount_applied), 0) into v_sum
    from public.receipt_allocations ra
    join public.receipts r on r.id = ra.receipt_id
   where ra.invoice_id = new.invoice_id
     and ra.id <> new.id
     and r.status <> 'canceled';

  if v_sum + new.amount_applied > v_total + 0.01 then
    raise exception 'La imputación excede el total del comprobante (% + % > %)',
      v_sum, new.amount_applied, v_total using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_receipt_allocation on public.receipt_allocations;
create trigger guard_receipt_allocation
  before insert or update on public.receipt_allocations
  for each row execute function public.guard_receipt_allocation();

-- Payment orders -> purchase invoices -----------------------------------------
create or replace function public.guard_payment_order_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supplier uuid;
  v_total    numeric;
  v_po_supplier uuid;
  v_sum      numeric;
begin
  select supplier_id, imp_total into v_supplier, v_total
    from public.purchase_invoices where id = new.purchase_invoice_id for update;
  if not found then
    raise exception 'Factura de compra % no existe', new.purchase_invoice_id using errcode = '23503';
  end if;

  select supplier_id into v_po_supplier from public.payment_orders where id = new.payment_order_id;
  if v_po_supplier is distinct from v_supplier then
    raise exception 'La factura no pertenece al proveedor de la orden de pago'
      using errcode = '23514';
  end if;

  select coalesce(sum(poa.amount_applied), 0) into v_sum
    from public.payment_order_allocations poa
    join public.payment_orders po on po.id = poa.payment_order_id
   where poa.purchase_invoice_id = new.purchase_invoice_id
     and poa.id <> new.id
     and po.status <> 'canceled';

  if v_sum + new.amount_applied > v_total + 0.01 then
    raise exception 'La imputación excede el total de la factura (% + % > %)',
      v_sum, new.amount_applied, v_total using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_payment_order_allocation on public.payment_order_allocations;
create trigger guard_payment_order_allocation
  before insert or update on public.payment_order_allocations
  for each row execute function public.guard_payment_order_allocation();

set row_security = on;
