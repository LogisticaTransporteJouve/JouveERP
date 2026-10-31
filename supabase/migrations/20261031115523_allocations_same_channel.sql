SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A document only settles or corrects documents of its own invoicing channel,
-- so internal (non-fiscal) activity never moves a fiscal balance:
--   * receipt_allocations: receipt.channel_id = invoice.channel_id
--   * payment_order_allocations: payment_order.channel_id = purchase_invoice.channel_id
--   * invoices / purchase_invoices: an NC/ND has the same channel (and
--     client / supplier) as its invoice_origin_id
-- Only new writes are checked: existing rows stay as they are. Editing a receipt
-- or payment order re-inserts its allocations, so a historical cross-channel
-- one has to be fixed before it can be edited.

-- Receipts -> invoices ---------------------------------------------------------
-- Body of 20261016100000_invoicing_integrity.sql plus the channel check.
create or replace function public.guard_receipt_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client   uuid;
  v_channel  text;
  v_total    numeric;
  v_status   text;
  v_kind     text;
  v_receipt_client  uuid;
  v_receipt_channel text;
  v_receipt_created timestamptz;
  v_sum      numeric;
  v_credited numeric;
begin
  select client_id, channel_id, imp_total, status, kind
    into v_client, v_channel, v_total, v_status, v_kind
    from public.invoices where id = new.invoice_id for update;
  if not found then
    raise exception 'Comprobante % no existe', new.invoice_id using errcode = '23503';
  end if;
  if v_status <> 'emitted' or v_kind not in ('factura', 'nd') then
    raise exception 'Solo se pueden imputar facturas y notas de débito emitidas'
      using errcode = '23514';
  end if;

  select client_id, channel_id, created_at
    into v_receipt_client, v_receipt_channel, v_receipt_created
    from public.receipts where id = new.receipt_id;
  if v_receipt_client is distinct from v_client then
    raise exception 'El comprobante no pertenece al cliente del recibo'
      using errcode = '23514';
  end if;
  if v_receipt_channel is distinct from v_channel then
    raise exception 'El comprobante es de otro canal que el recibo: un recibo solo cancela comprobantes de su mismo canal'
      using errcode = '23514';
  end if;

  select coalesce(sum(ra.amount_applied), 0) into v_sum
    from public.receipt_allocations ra
    join public.receipts r on r.id = ra.receipt_id
   where ra.invoice_id = new.invoice_id
     and ra.id <> new.id
     and r.status <> 'canceled';

  select coalesce(sum(n.imp_total), 0) into v_credited
    from public.invoices n
   where n.invoice_origin_id = new.invoice_id
     and n.kind = 'nc'
     and n.status = 'emitted'
     -- NCs issued after this receipt existed don't shrink what it may keep.
     and coalesce(n.emitted_at, n.created_at) < v_receipt_created;

  if v_sum + v_credited + new.amount_applied > v_total + 0.01 then
    raise exception 'La imputación excede el saldo del comprobante (% + % + % > %)',
      v_sum, v_credited, new.amount_applied, v_total using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_receipt_allocation() from public, anon, authenticated;

-- Payment orders -> purchase invoices -----------------------------------------
-- Body of 20260704230000_audit_t4_allocation_guards.sql plus the channel check.
create or replace function public.guard_payment_order_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier uuid;
  v_channel  text;
  v_total    numeric;
  v_po_supplier uuid;
  v_po_channel  text;
  v_sum      numeric;
begin
  select supplier_id, channel_id, imp_total into v_supplier, v_channel, v_total
    from public.purchase_invoices where id = new.purchase_invoice_id for update;
  if not found then
    raise exception 'Factura de compra % no existe', new.purchase_invoice_id using errcode = '23503';
  end if;

  select supplier_id, channel_id into v_po_supplier, v_po_channel
    from public.payment_orders where id = new.payment_order_id;
  if v_po_supplier is distinct from v_supplier then
    raise exception 'La factura no pertenece al proveedor de la orden de pago'
      using errcode = '23514';
  end if;
  if v_po_channel is distinct from v_channel then
    raise exception 'La factura es de otro canal que la orden de pago: una OP solo cancela facturas de su mismo canal'
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

revoke all on function public.guard_payment_order_allocation() from public, anon, authenticated;

-- Sales NC/ND origin -----------------------------------------------------------
-- issueFiscalInvoiceAction already checks this; the trigger covers every other
-- write path. An emitted header is immutable (check_invoice_immutability), so
-- an origin cannot change channel or client afterwards.
create or replace function public.guard_invoice_origin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client  uuid;
  v_channel text;
begin
  if new.invoice_origin_id is null then
    return new;
  end if;
  select client_id, channel_id into v_client, v_channel
    from public.invoices where id = new.invoice_origin_id;
  if not found then
    return new; -- the FK reports it
  end if;
  if v_client is distinct from new.client_id then
    raise exception 'El comprobante de origen es de otro cliente'
      using errcode = '23514';
  end if;
  if v_channel is distinct from new.channel_id then
    raise exception 'El comprobante de origen es de otro canal: una NC/ND va en el mismo canal que su comprobante'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_invoice_origin() from public, anon, authenticated;

drop trigger if exists guard_invoice_origin on public.invoices;
create trigger guard_invoice_origin
  before insert or update of invoice_origin_id, channel_id, client_id on public.invoices
  for each row execute function public.guard_invoice_origin();

-- Purchase NC/ND origin --------------------------------------------------------
-- A received purchase invoice can still be edited, so the check runs both ways:
-- the NC/ND against its origin, and an origin against the NC/ND that cite it.
create or replace function public.guard_purchase_invoice_origin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier uuid;
  v_channel  text;
begin
  if new.invoice_origin_id is not null then
    select supplier_id, channel_id into v_supplier, v_channel
      from public.purchase_invoices where id = new.invoice_origin_id;
    if found then
      if v_supplier is distinct from new.supplier_id then
        raise exception 'La factura de origen es de otro proveedor'
          using errcode = '23514';
      end if;
      if v_channel is distinct from new.channel_id then
        raise exception 'La factura de origen es de otro canal: una NC/ND va en el mismo canal que su factura'
          using errcode = '23514';
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE'
     and (new.channel_id is distinct from old.channel_id
          or new.supplier_id is distinct from old.supplier_id)
     and exists (
       select 1 from public.purchase_invoices n
        where n.invoice_origin_id = new.id
          and (n.channel_id is distinct from new.channel_id
               or n.supplier_id is distinct from new.supplier_id)
     ) then
    raise exception 'Esta factura es origen de una NC/ND: no se le puede cambiar el canal ni el proveedor'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_purchase_invoice_origin() from public, anon, authenticated;

drop trigger if exists guard_purchase_invoice_origin on public.purchase_invoices;
create trigger guard_purchase_invoice_origin
  before insert or update of invoice_origin_id, channel_id, supplier_id on public.purchase_invoices
  for each row execute function public.guard_purchase_invoice_origin();
