SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W7 · S4 F1: the payment lines of a payment order, and the payment
-- lines and retentions of a receipt, are written only by their document's
-- RPC. RLS lets owner, admin and finance insert, update and delete them, and
-- they carry money:
-- - v_supplier_rejected_check_open finds the supplier of a bounced check
--   through payment_order_payment_lines.endorsed_check_id, so a line added to
--   any order made that supplier owe the check;
-- - emit_journal_for_endorsed_check_rejected takes the amount of the
--   «Rechazo cheque endosado» entry from the line;
-- - handle_payment_order_cancellation puts the order's endorsed checks back in
--   the cartera through its lines, so a line moved to another order returned
--   a check that order never endorsed;
-- - build_receipt_journal_lines / build_payment_order_journal_lines debit and
--   credit each line's account and amount, and each retention, on every
--   re-post.
--
-- The writers, latest definitions: create_payment_order / update_payment_order
-- and create_receipt / update_receipt (settle_billed_remito and the driver
-- settlements reach create_receipt, impute_purchase_remitos reaches
-- create_payment_order), recognised in the call stack (pg_context) as
-- guard_check_movement does. The foreign-key actions (a header's delete
-- cascade, an own check's delete setting issued_check_id to null) run at
-- pg_trigger_depth() > 1 and carry no caller values; no trigger inserts a
-- line, so an insert never takes that way. No app code writes these tables.
--
-- The RLS policies are not changed. Existing rows are not touched.
--
-- Rollback: older code writes these rows only through those RPCs, so it is
-- unaffected.

create function public.guard_document_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if tg_op <> 'INSERT' and pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  get diagnostics v_stack = pg_context;
  if tg_table_name = 'payment_order_payment_lines' then
    if v_stack ~ 'function (public\.)?(create_payment_order|update_payment_order)\(' then
      return coalesce(new, old);
    end if;
    raise exception 'Las líneas de pago de una orden de pago se escriben solo desde la orden de pago: editala o anulala'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if v_stack ~ 'function (public\.)?(create_receipt|update_receipt)\(' then
    return coalesce(new, old);
  end if;
  raise exception 'Las líneas de cobro y las retenciones de un recibo se escriben solo desde el recibo: editalo o anulalo'
    using errcode = '55006', hint = 'jouve_guard';
end;
$$;

revoke all on function public.guard_document_line() from public, anon, authenticated;

-- After payment_order_payment_lines_check_channel (triggers fire in name
-- order), so its channel message still wins.
create trigger payment_order_payment_lines_guard_rpc
  before insert or update or delete on public.payment_order_payment_lines
  for each row execute function public.guard_document_line();

create trigger receipt_payment_lines_guard_rpc
  before insert or update or delete on public.receipt_payment_lines
  for each row execute function public.guard_document_line();

create trigger receipt_retentions_guard_rpc
  before insert or update or delete on public.receipt_retentions
  for each row execute function public.guard_document_line();
