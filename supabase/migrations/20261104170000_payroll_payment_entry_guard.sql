SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W10 · S2 F1 / S4 F2: a payroll payment pays the entry its insert
-- named.
--
-- RLS lets owner, admin and finance PATCH every column of payroll_payments,
-- and 20261104160000 pinned only transaction_id. A PATCH of entry_id moved a
-- payment to another employee's or another period's entry: the first entry
-- read unpaid again (v_payroll_entries_with_payments sums by entry_id, and
-- «Pagar» paid it a second time with no overpay prompt), while the movement
-- kept the first employee's description and accrual month, which the sync
-- writes only on insert.
--
-- The writers of entry_id, latest definitions: the create and bulk actions
-- insert it; updatePayrollPaymentAction updates account, channel, amount,
-- method, date and notes; the delete action and the payroll_entries cascade
-- (on delete cascade) only delete; no SQL function, seed or importer updates
-- payroll_payments. Nothing changes entry_id after the insert.
--
-- Same guard_payroll_payment_transaction as 20261104160000 plus the entry
-- message, and its trigger now fires when either link changes.
--
-- Existing rows are not touched. Rollback: older code never writes entry_id
-- on update.

create or replace function public.guard_payroll_payment_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.entry_id is distinct from old.entry_id then
    raise exception 'Un pago de sueldo queda en la liquidación en que se cargó: para pagarle a otra, borralo y cargalo de nuevo'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  raise exception 'El movimiento de un pago de sueldo lo crea el pago y no se cambia: editá el pago, o borralo y cargalo de nuevo'
    using errcode = '55006', hint = 'jouve_guard';
end;
$$;

revoke all on function public.guard_payroll_payment_transaction() from public, anon, authenticated;

drop trigger payroll_payments_guard_transaction on public.payroll_payments;
create trigger payroll_payments_guard_transaction
  before update on public.payroll_payments
  for each row
  when (new.transaction_id is distinct from old.transaction_id
        or new.entry_id is distinct from old.entry_id)
  execute function public.guard_payroll_payment_transaction();
