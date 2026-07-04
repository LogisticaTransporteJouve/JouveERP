-- Audit remediation T4 — block amount/date/account edits on system-generated
-- transactions (those linked to a receipt, payment order, transfer pair, or
-- invoice).
--
-- updateTransactionAction freely edited amount/date of any transaction, including
-- receipt/PO-generated rows and one half of a transfer pair. The journal sync
-- triggers on transactions fire only on INSERT/DELETE (no UPDATE trigger), so an
-- edited amount left the ledger and the source document out of sync, and a
-- one-sided transfer edit broke conservation.
--
-- Legit edits to receipts/POs go through their RPCs, which DELETE + reinsert the
-- child transactions (not UPDATE), so this trigger does not interfere. Free-text
-- fields (description, counterparty_client_id) remain editable.

set row_security = off;

create or replace function public.guard_transaction_immutable_when_linked()
returns trigger
language plpgsql
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
      using errcode = '55006';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_transaction_immutable_when_linked on public.transactions;
create trigger guard_transaction_immutable_when_linked
  before update on public.transactions
  for each row execute function public.guard_transaction_immutable_when_linked();

set row_security = on;
