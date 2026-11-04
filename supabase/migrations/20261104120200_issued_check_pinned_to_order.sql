SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W4 · S2 F1: an own check a payment order issued keeps that
-- order, amount, currency and bank account. Cashing or bouncing it reads
-- them (issued_check_rejected_inflow, the transition entry, the cashed
-- outflow of a hand-loaded check, the live-order cancel guard), so clearing
-- payment_order_id or changing the amount over PostgREST counted the money
-- twice. Only the app refused it; the database now does too.
--
-- update_payment_order deletes and re-inserts its checks and the order's
-- cancellation changes only status, so no writer is affected. Existing rows
-- are not touched.
--
-- Rollback: older code already refuses these edits in updateIssuedCheckAction
-- with the same message.

-- Same as 20261104093300 plus the check pinned to its order.
create or replace function public.guard_issued_check_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.payment_order_id is not null
     and (new.payment_order_id is distinct from old.payment_order_id
       or new.amount          is distinct from old.amount
       or new.currency        is distinct from old.currency
       or new.bank_account_id is distinct from old.bank_account_id) then
    raise exception 'El cheque está ligado a una orden de pago: el monto, la moneda, la cuenta y la OP se cambian editando la orden de pago'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if old.status <> 'emitted'
     and (new.amount          is distinct from old.amount
       or new.currency        is distinct from old.currency
       or new.bank_account_id is distinct from old.bank_account_id) then
    raise exception 'El cheque ya no está emitido: su monto, moneda y cuenta quedaron registrados en Caja y no se pueden cambiar'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if new.payment_order_id is not null
     and new.payment_order_id is distinct from old.payment_order_id then
    raise exception 'Un cheque propio se liga a una orden de pago solo cargándolo desde la orden de pago'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_issued_check_edit() from public, anon, authenticated;
