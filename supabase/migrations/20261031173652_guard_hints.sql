SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Guard rejections carry hint 'jouve_guard', so the app (lib/db/guard-errors.ts)
-- tells a business-rule rejection from any other database error without
-- matching on message text. Each function is recreated with its latest body,
-- signature and SECURITY mode; only the hint is added, plus:
--   * guard_journal_period_closed: search_path '' and revoked from all three
--     roles (a trigger function; nobody calls it directly);
--   * guard_transaction_immutable_when_linked and
--     guard_cancel_invoice_with_allocations: stay INVOKER, get search_path ''
--     and are revoked from public and anon.

-- Same-channel guards: bodies of 20261031115523_allocations_same_channel.sql.

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
    raise exception 'Comprobante % no existe', new.invoice_id using errcode = '23503', hint = 'jouve_guard';
  end if;
  if v_status <> 'emitted' or v_kind not in ('factura', 'nd') then
    raise exception 'Solo se pueden imputar facturas y notas de débito emitidas'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select client_id, channel_id, created_at
    into v_receipt_client, v_receipt_channel, v_receipt_created
    from public.receipts where id = new.receipt_id;
  if v_receipt_client is distinct from v_client then
    raise exception 'El comprobante no pertenece al cliente del recibo'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_receipt_channel is distinct from v_channel then
    raise exception 'El comprobante es de otro canal que el recibo: un recibo solo cancela comprobantes de su mismo canal'
      using errcode = '23514', hint = 'jouve_guard';
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
      v_sum, v_credited, new.amount_applied, v_total using errcode = '23514', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_receipt_allocation() from public, anon, authenticated;

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
    raise exception 'Factura de compra % no existe', new.purchase_invoice_id using errcode = '23503', hint = 'jouve_guard';
  end if;

  select supplier_id, channel_id into v_po_supplier, v_po_channel
    from public.payment_orders where id = new.payment_order_id;
  if v_po_supplier is distinct from v_supplier then
    raise exception 'La factura no pertenece al proveedor de la orden de pago'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_po_channel is distinct from v_channel then
    raise exception 'La factura es de otro canal que la orden de pago: una OP solo cancela facturas de su mismo canal'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select coalesce(sum(poa.amount_applied), 0) into v_sum
    from public.payment_order_allocations poa
    join public.payment_orders po on po.id = poa.payment_order_id
   where poa.purchase_invoice_id = new.purchase_invoice_id
     and poa.id <> new.id
     and po.status <> 'canceled';

  if v_sum + new.amount_applied > v_total + 0.01 then
    raise exception 'La imputación excede el total de la factura (% + % > %)',
      v_sum, new.amount_applied, v_total using errcode = '23514', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_payment_order_allocation() from public, anon, authenticated;

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
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_channel is distinct from new.channel_id then
    raise exception 'El comprobante de origen es de otro canal: una NC/ND va en el mismo canal que su comprobante'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_invoice_origin() from public, anon, authenticated;

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
          using errcode = '23514', hint = 'jouve_guard';
      end if;
      if v_channel is distinct from new.channel_id then
        raise exception 'La factura de origen es de otro canal: una NC/ND va en el mismo canal que su factura'
          using errcode = '23514', hint = 'jouve_guard';
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
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_purchase_invoice_origin() from public, anon, authenticated;

-- Closed periods: body of 20260704250000_audit_t6_period_close.sql.
create or replace function public.guard_journal_period_closed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period text := coalesce(new.accrual_period, old.accrual_period);
begin
  if exists (select 1 from public.accounting_closed_periods where period = v_period) then
    raise exception 'El período contable % está cerrado y no admite movimientos', v_period
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.guard_journal_period_closed() from public, anon, authenticated;

-- System-generated transactions: body of 20260704220000_audit_t4_transaction_edit_guard.sql.
create or replace function public.guard_transaction_immutable_when_linked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (old.receipt_id is not null
      or old.payment_order_id is not null
      or old.transfer_pair_id is not null
      or old.invoice_id is not null)
     and (new.amount           is distinct from old.amount
       or new.transaction_date is distinct from old.transaction_date
       or new.accrual_month    is distinct from old.accrual_month
       or new.account_id       is distinct from old.account_id
       or new.kind             is distinct from old.kind) then
    raise exception
      'No se puede editar monto, fecha, cuenta o tipo de un movimiento generado por un recibo, orden de pago, transferencia o comprobante'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_transaction_immutable_when_linked() from public, anon;

-- Cancelling an internal invoice with money applied: body of
-- 20261016100000_invoicing_integrity.sql. The messages drop the invoice id so
-- the app shows them as they are (cancelInvoiceAction matched "saldo inicial"
-- in the text before).
create or replace function public.guard_cancel_invoice_with_allocations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'emitted' and new.status = 'cancelled' then
    if exists (
      select 1
        from public.receipt_allocations ra
        join public.receipts r on r.id = ra.receipt_id
       where ra.invoice_id = old.id
         and r.status = 'issued'
    ) then
      raise exception 'El comprobante tiene recibos imputados. Anulá esos recibos antes de anularlo.'
        using errcode = '22023', hint = 'jouve_guard';
    end if;
    if exists (
      select 1
        from public.client_opening_balance_allocations oba
       where oba.invoice_id = old.id
    ) then
      raise exception 'El comprobante está saldado por el saldo inicial del cliente. Recalculá el saldo inicial antes de anularlo.'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_cancel_invoice_with_allocations() from public, anon;
