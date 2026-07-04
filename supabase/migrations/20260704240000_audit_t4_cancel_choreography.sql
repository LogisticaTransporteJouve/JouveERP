-- Audit remediation T4 — protect cancellation choreography for payment orders
-- and receipts.
--
-- (1) Cancelling a payment order deletes its transactions. If the PO paid with an
--     own issued check that the supplier already cashed, deleting the bank
--     expense makes caja "recover" money that actually left. Block the cancel
--     when any linked issued check is cashed or rejected.
-- (2) Cancelling a receipt left its auto-created third-party checks behind, still
--     'en_cartera' and spendable, while the cartera income was deleted — a
--     phantom check. Block the cancel if a linked check was already deposited/
--     endorsed/credited/rejected (revert the check first), and delete the ones
--     still 'en_cartera' so they disappear with the receipt.
--
-- Additive BEFORE-UPDATE guards; the existing AFTER cancellation handlers are
-- untouched. Status spellings: payment_orders/receipts use 'canceled' (one l),
-- issued_checks 'cashed'/'rejected', checks 'en_cartera' et al.

set row_security = off;

-- (1) Payment order --------------------------------------------------------
create or replace function public.guard_payment_order_cancel_cashed_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'issued' and new.status = 'canceled' then
    if exists (
      select 1 from public.issued_checks ic
       where ic.payment_order_id = old.id
         and ic.status in ('cashed', 'rejected')
    ) then
      raise exception
        'No se puede anular la orden de pago: tiene un cheque emitido ya cobrado o rechazado. Gestioná el cheque primero.'
        using errcode = '55006';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_payment_order_cancel_cashed_check on public.payment_orders;
create trigger guard_payment_order_cancel_cashed_check
  before update on public.payment_orders
  for each row execute function public.guard_payment_order_cancel_cashed_check();

-- (2) Receipt --------------------------------------------------------------
create or replace function public.guard_receipt_cancel_phantom_checks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'issued' and new.status = 'canceled' then
    if exists (
      select 1 from public.checks c
       where c.source_receipt_id = old.id
         and c.status <> 'en_cartera'
    ) then
      raise exception
        'No se puede anular el recibo: un cheque recibido ya fue depositado/endosado. Revertí el cheque primero.'
        using errcode = '55006';
    end if;
    -- Checks still in cartera never really entered: remove them with the receipt.
    delete from public.checks
     where source_receipt_id = old.id
       and status = 'en_cartera';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_receipt_cancel_phantom_checks on public.receipts;
create trigger guard_receipt_cancel_phantom_checks
  before update on public.receipts
  for each row execute function public.guard_receipt_cancel_phantom_checks();

set row_security = on;
