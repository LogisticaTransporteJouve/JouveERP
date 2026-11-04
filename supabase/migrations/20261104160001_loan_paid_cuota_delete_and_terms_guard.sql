SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W9 · S4 F2.
--
-- 1. A paid cuota is not deleted. RLS lets owner, admin and finance DELETE
--    loan_installments, and guard_loan_installment_payment (20261104150001)
--    ran on insert and update only. Deleting a paid cuota freed its outflow
--    (guard_transaction_owned_by_document no longer saw an owner, so Caja
--    could edit or delete it), and the cuota could be inserted again pending
--    and paid a second time: a second outflow and a second capital entry.
--
--    The writers that delete cuotas, latest definitions: none deletes one
--    directly (no app, seed or SQL statement). The only path is the cascade
--    from a loan delete (the old createLoanAction's compensating delete and
--    undo_import_run, 20261103140100), which guard_loan admits only when the
--    loan has no disbursement and no paid cuota; the cascade runs at
--    pg_trigger_depth() > 1.
--
--    Same function plus a DELETE case, on a trigger of its own: a cuota that
--    is paid, or carries a payment field, is deleted only by that cascade.
--
-- 2. A loan's terms stay once its money is booked. principal, currency and
--    channel_id were open to PATCH, and the capital of an unsplit cuota is
--    principal minus the earlier cuotas once the liability is booked
--    (build_transaction_journal_lines, 20261104101300: disbursement recorded
--    or loaded by the importer); the disbursement was checked against them
--    (record_loan_disbursement) and every cuota payment takes the loan's
--    currency and channel. status was open as well: a PATCH to «paid» or back
--    to «active» skipped the payment RPCs.
--
--    The writers, latest definitions: no app or SQL statement updates
--    principal, currency or channel_id (loans are inserted by create_loan and
--    commit_import_run, and the app edits no loan header). status changes in
--    cancelLoanAction (active → cancelled, a direct update that guard_loan
--    vets) and in pay_loan_installment / adopt_loan_installment_payment
--    (20261103040100: → paid, once no cuota is pending). Nothing sets a loan
--    back to active.
--
--    Same guard_loan as 20261104150001 plus, on update:
--    - principal, currency and channel_id do not change once the disbursement
--      is recorded, the loan was imported, or a cuota is paid;
--    - status moves only active → cancelled (as before) or → paid inside the
--      payment RPCs.
--
-- The RLS policies are not changed. Existing rows are not touched.
--
-- Rollback: older code deletes cuotas only through a loan delete with nothing
-- paid, cancels with the same update and marks loans paid through the same
-- RPCs; it never edits a loan's terms.

-- 1. Cuota delete -------------------------------------------------------------------

-- Same as 20261104150001 plus the DELETE case.
create or replace function public.guard_loan_installment_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    if old.status <> 'pendiente'
       or old.paid_date is not null
       or old.paid_amount is not null
       or old.transaction_id is not null then
      raise exception 'No se puede borrar una cuota pagada: su pago queda en Caja y en el libro diario'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'pendiente'
       or new.paid_date is not null
       or new.paid_amount is not null
       or new.transaction_id is not null then
      raise exception 'Una cuota se carga pendiente: se paga después con «Pagar» o «Usar un egreso ya cargado»'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    return new;
  end if;

  if new.status         is not distinct from old.status
     and new.paid_date      is not distinct from old.paid_date
     and new.paid_amount    is not distinct from old.paid_amount
     and new.transaction_id is not distinct from old.transaction_id then
    return new;
  end if;

  if pg_trigger_depth() > 1 then
    return new;
  end if;
  get diagnostics v_stack = pg_context;
  if v_stack ~ 'function (public\.)?(pay_loan_installment|adopt_loan_installment_payment)\(' then
    return new;
  end if;
  raise exception 'El estado, la fecha y el importe pagados y el movimiento de una cuota se cambian solo pagándola («Pagar» o «Usar un egreso ya cargado»)'
    using errcode = '55006', hint = 'jouve_guard';
end;
$$;

revoke all on function public.guard_loan_installment_payment() from public, anon, authenticated;

create trigger loan_installments_guard_payment_delete
  before delete on public.loan_installments
  for each row execute function public.guard_loan_installment_payment();

-- 2. Loan terms and status ------------------------------------------------------------

-- Same as 20261104150001 plus the terms and the status rules.
create or replace function public.guard_loan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if tg_op = 'INSERT' then
    if new.disbursement_transaction_id is not null then
      raise exception 'El desembolso de un préstamo se registra solo con «Registrar desembolso»'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.disbursement_transaction_id is not null
     and new.disbursement_transaction_id is distinct from old.disbursement_transaction_id then
    raise exception 'El desembolso registrado de un préstamo no se puede cambiar'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if tg_op = 'UPDATE'
     and old.disbursement_transaction_id is null
     and new.disbursement_transaction_id is not null then
    get diagnostics v_stack = pg_context;
    if v_stack !~ 'function (public\.)?record_loan_disbursement\(' then
      raise exception 'El desembolso de un préstamo se registra solo con «Registrar desembolso»'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
  end if;

  if (tg_op = 'DELETE'
      or (new.status = 'cancelled' and old.status is distinct from 'cancelled'))
     and (old.disbursement_transaction_id is not null
          or exists (select 1 from public.loan_installments i
                      where i.loan_id = old.id and i.status = 'pagada')) then
    raise exception 'No se puede anular el préstamo: tiene el desembolso registrado o cuotas pagadas, y sus movimientos quedarían en Caja y en el libro diario. Anulalo solo si se cargó por error y todavía no registró dinero.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if (new.principal   is distinct from old.principal
      or new.currency   is distinct from old.currency
      or new.channel_id is distinct from old.channel_id)
     and (old.disbursement_transaction_id is not null
          or old.import_run_id is not null
          or exists (select 1 from public.loan_installments i
                      where i.loan_id = old.id and i.status = 'pagada')) then
    raise exception 'El capital, la moneda y el canal de un préstamo no cambian una vez registrado su desembolso o pagada una cuota'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.status is distinct from old.status
     and not (old.status = 'active' and new.status = 'cancelled') then
    get diagnostics v_stack = pg_context;
    if not (old.status = 'active' and new.status = 'paid'
            and v_stack ~ 'function (public\.)?(pay_loan_installment|adopt_loan_installment_payment)\(') then
      raise exception 'Un préstamo queda pagado solo al pagar su última cuota, y anulado solo con «Anular»'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_loan() from public, anon, authenticated;
