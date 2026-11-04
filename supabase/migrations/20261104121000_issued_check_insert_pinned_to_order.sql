SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W5 · S2 F1: an own check is linked to a payment order only by
-- that order's RPC. 20261104120200 pinned the link on UPDATE, but an INSERT
-- over PostgREST (owner, admin and finance may insert issued_checks) could
-- still create a check already linked to an issued order. Bouncing it then
-- booked a bank inflow, a supplier debt and a ledger reversal for money the
-- order never paid; cashing it posted Dr cheques diferidos / Cr banco with no
-- Caja outflow.
--
-- The trusted callers are create_payment_order and update_payment_order,
-- recognised in the call stack (pg_context), as
-- guard_transaction_owned_by_document does. A check inserted without an order
-- (the hand-loaded one of /cheques-emitidos) is not touched. Existing rows are
-- not touched.
--
-- Rollback: older code inserts linked checks only through those two RPCs.

-- Same as 20261104120200 plus the INSERT branch.
create or replace function public.guard_issued_check_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if tg_op = 'INSERT' then
    if new.payment_order_id is not null then
      get diagnostics v_stack = pg_context;
      if v_stack !~ 'function (public\.)?(create_payment_order|update_payment_order)\(' then
        raise exception 'Un cheque propio se liga a una orden de pago solo cargándolo desde la orden de pago'
          using errcode = '55006', hint = 'jouve_guard';
      end if;
    end if;
    return new;
  end if;

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

drop trigger issued_checks_guard_edit on public.issued_checks;

create trigger issued_checks_guard_edit
  before insert or update on public.issued_checks
  for each row execute function public.guard_issued_check_edit();
