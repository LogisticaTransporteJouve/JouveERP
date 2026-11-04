SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W9 · S4 F1 / S2 F1: a payroll payment's movement is the one its
-- insert created.
--
-- RLS lets owner, admin and finance PATCH every column of payroll_payments,
-- and nothing pinned transaction_id. payroll_payment_sync_transaction
-- (20261103050100) then rewrote whatever movement the column named (account,
-- channel, amount, date) on update, and deleted it on delete, at
-- pg_trigger_depth() = 2, where guard_transaction_owned_by_document and
-- guard_transaction_origin step aside. A PATCH could reshape a loan cuota's,
-- a check's or a receipt's movement, or free the payment's own outflow so
-- Caja could delete it while the planilla still read paid.
--
-- The writers, latest definitions: the before-insert sync sets the column
-- (`returning id into new.transaction_id`, overwriting whatever the insert
-- sent). Nothing else writes it: updatePayrollPaymentAction updates account,
-- channel, amount, method, date and notes; the bulk payment and the create
-- action only insert; the delete action and the payroll_entries cascade only
-- delete; no SQL function updates payroll_payments; the seed and the
-- importer do not write the table. The FK is on delete restrict
-- (20261031193400), so no foreign-key action writes it either.
--
-- guard_payroll_payment_transaction: once inserted, transaction_id does not
-- change. With the link fixed, the sync's update and delete reach only the
-- payment's own movement.
--
-- Existing rows are not touched. Rollback: older code never writes the
-- column.

create function public.guard_payroll_payment_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'El movimiento de un pago de sueldo lo crea el pago y no se cambia: editá el pago, o borralo y cargalo de nuevo'
    using errcode = '55006', hint = 'jouve_guard';
end;
$$;

revoke all on function public.guard_payroll_payment_transaction() from public, anon, authenticated;

create trigger payroll_payments_guard_transaction
  before update on public.payroll_payments
  for each row
  when (new.transaction_id is distinct from old.transaction_id)
  execute function public.guard_payroll_payment_transaction();
