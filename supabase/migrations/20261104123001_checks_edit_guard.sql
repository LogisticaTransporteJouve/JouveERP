SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W5 · S2 F2: a third-party check keeps the amount, currency,
-- cartera, receipt and status its RPCs gave it. RLS lets owner, admin and
-- finance UPDATE public.checks, and nothing pinned those columns, so a
-- PostgREST PATCH (amount 100 → 150, or depositado → en_cartera) made
-- deposit_check move the new amount, or move it twice, and broke
-- cartera = Σ checks en cartera.
--
-- The grant stays: deposit_check, credit_check, reject_check and
-- create_payment_order are security invoker and update the row as the user.
-- No app code updates checks directly (every transition is an RPC), so the
-- guard lets through only those RPCs, recognised in the call stack
-- (pg_context) as guard_transaction_owned_by_document does, and the triggers
-- that cascade a document's change (pg_trigger_depth() > 1: an order's
-- cancellation, a sale's cancellation, an endorsement's channel). Notes, due
-- date and the other descriptive columns stay editable; the channel keeps its
-- own guard. The RLS policies are not changed. Existing rows are not touched.
--
-- Rollback: older code never PATCHes checks, so it is unaffected.

create or replace function public.guard_check_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if new.amount             is not distinct from old.amount
     and new.currency           is not distinct from old.currency
     and new.cartera_account_id is not distinct from old.cartera_account_id
     and new.source_receipt_id  is not distinct from old.source_receipt_id
     and new.status             is not distinct from old.status then
    return new;
  end if;

  get diagnostics v_stack = pg_context;
  if pg_trigger_depth() > 1
     or v_stack ~ 'function (public\.)?(deposit_check|credit_check|reject_check|sell_checks|reject_sold_check_as_debt|create_payment_order|update_payment_order)\(' then
    return new;
  end if;

  raise exception 'El monto, la moneda, la cartera, el recibo y el estado de un cheque se cambian solo desde sus acciones (depositar, acreditar, rechazar, vender) o desde la orden de pago que lo endosa'
    using errcode = '55006', hint = 'jouve_guard';
end;
$$;

revoke all on function public.guard_check_edit() from public, anon, authenticated;

create trigger checks_guard_edit
  before update on public.checks
  for each row execute function public.guard_check_edit();
