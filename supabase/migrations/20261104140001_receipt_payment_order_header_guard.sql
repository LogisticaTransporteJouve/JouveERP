SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W7 · S2 F2: the header of a receipt or a payment order changes
-- only through its RPC. RLS lets owner, admin and finance PATCH every column,
-- and the cancellation and journal triggers act only on issued → canceled:
-- - canceled → issued credited the client again (v_client_account_movements)
--   with no Caja inflow behind it, or debited the supplier again for an order
--   whose endorsed check was already back in the cartera;
-- - a PATCH of total_amount, the counterparty, the channel or the date moved
--   the cuenta corriente, aging and the re-posted entry
--   (receipts_repost_journal) away from what Caja recorded.
--
-- The writers, latest definitions:
-- - update_receipt / update_payment_order rewrite the date, the total, the
--   rate and the notes;
-- - the app's «Anular», settle_billed_remito, impute_purchase_remitos and
--   remove_driver_settlement_difference only cancel (issued → canceled);
-- - confirm_driver_settlement, post_driver_settlement_difference and
--   impute_purchase_remitos stamp created_by; sending the email stamps
--   notified_at.
-- So: the status moves only issued → canceled, and the money and identity
-- columns change only inside update_receipt / update_payment_order
-- (pg_context, as guard_driver_settlement_difference_receipt does). Notes,
-- cost center, notified_at, created_by and the cancel stamps stay free.
--
-- The RLS policies are not changed. Existing rows are not touched.
--
-- Rollback: older code changes these columns only in the ways above, so it
-- is unaffected.

create function public.guard_document_header()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
  v_old   jsonb := to_jsonb(old);
  v_new   jsonb := to_jsonb(new);
  v_keys  text[];
begin
  if new.status is distinct from old.status
     and not (old.status = 'issued' and new.status = 'canceled') then
    raise exception 'Un documento anulado no se vuelve a emitir: cargá uno nuevo'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  v_keys := case tg_table_name
    when 'receipts' then
      array['total_amount', 'currency', 'cotizacion', 'client_id', 'channel_id',
            'receipt_date', 'punto_venta', 'numero']
    else
      array['total_amount', 'currency', 'cotizacion', 'supplier_id', 'channel_id',
            'payment_date', 'punto_venta', 'numero']
  end;
  if not exists (
    select 1 from unnest(v_keys) k where v_new -> k is distinct from v_old -> k
  ) then
    return new;
  end if;

  get diagnostics v_stack = pg_context;
  if tg_table_name = 'receipts' then
    if v_stack ~ 'function (public\.)?update_receipt\(' then
      return new;
    end if;
    raise exception 'El monto, la moneda, la cotización, el cliente, el canal, la fecha y el número de un recibo se cambian solo editando el recibo'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if v_stack ~ 'function (public\.)?update_payment_order\(' then
    return new;
  end if;
  raise exception 'El monto, la moneda, la cotización, el proveedor, el canal, la fecha y el número de una orden de pago se cambian solo editando la orden de pago'
    using errcode = '55006', hint = 'jouve_guard';
end;
$$;

revoke all on function public.guard_document_header() from public, anon, authenticated;

-- After receipts_guard_cotizacion and receipts_guard_driver_settlement_difference
-- (triggers fire in name order), so their own messages still win.
create trigger receipts_guard_header
  before update on public.receipts
  for each row execute function public.guard_document_header();

create trigger payment_orders_guard_header
  before update on public.payment_orders
  for each row execute function public.guard_document_header();
