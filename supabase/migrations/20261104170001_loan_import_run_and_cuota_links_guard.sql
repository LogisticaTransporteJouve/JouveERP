SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W10 · S2 F2 / S4 F1: the loan guards of 20261104160001 key on
-- loans.import_run_id and on which loan a paid cuota belongs to, and both
-- were open to direct writes (RLS lets owner, admin and finance insert and
-- update every column of loans and loan_installments).
--
-- - import_run_id: clearing it on an imported loan unpinned its terms (the
--   terms pin holds an imported loan), and its unsplit cuotas then posted as
--   plain expense, not against the liability the import booked. Setting it
--   on a manual loan made unsplit cuotas debit prestamos for capital never
--   credited (build_transaction_journal_lines, 20261104101300).
-- - a paid cuota's loan_id: moving it to another loan hid it from every
--   guard_loan check (cancel, delete, terms), and moving it back restored it;
--   meanwhile it counted in the other loan's schedule and capital split.
-- - a paid cuota's number: the capital of an unsplit cuota is the principal
--   minus the cuotas numbered before it, so renumbering shifted that split.
--
-- The writers, latest definitions:
-- - loans.import_run_id: only commit_import_run sets it, on insert
--   (20261104070000). create_loan does not take it (20261104150001).
--   undo_import_run deletes the run's loans and never clears the column;
--   the FK is on delete restrict, so no foreign-key action writes it.
-- - loan_installments.loan_id and number: create_loan and commit_import_run
--   insert them; updateInstallmentAction updates amount, due date, notes and
--   the split; pay_loan_installment and adopt_loan_installment_payment
--   (20261103040100) update the status and payment fields; the loan delete
--   cascade only deletes. Nothing changes them after the insert.
--
-- So:
-- - guard_loan (same as 20261104160001 plus): an insert carries
--   import_run_id only from commit_import_run, and an update never changes
--   it.
-- - guard_loan_installment_payment (same as 20261104160001 plus): an update
--   never changes a cuota's loan_id, nor the number of a cuota that is paid
--   or carries a payment field.
--
-- The RLS policies are not changed. Existing rows are not touched.
--
-- Rollback: older code writes import_run_id only through commit_import_run
-- and never updates a cuota's loan or number.

-- 1. Loans ------------------------------------------------------------------------------

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
    if new.import_run_id is not null then
      get diagnostics v_stack = pg_context;
      if v_stack !~ 'function (public\.)?commit_import_run\(' then
        raise exception 'Un préstamo queda marcado como importado solo al importarlo desde «Importar datos»'
          using errcode = '55006', hint = 'jouve_guard';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.import_run_id is distinct from old.import_run_id then
    raise exception 'La importación de la que viene un préstamo no se cambia'
      using errcode = '55006', hint = 'jouve_guard';
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

-- 2. Cuotas -------------------------------------------------------------------------------

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

  if new.loan_id is distinct from old.loan_id then
    raise exception 'Una cuota no se pasa a otro préstamo'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.number is distinct from old.number
     and (old.status <> 'pendiente'
          or old.paid_date is not null
          or old.paid_amount is not null
          or old.transaction_id is not null) then
    raise exception 'No se puede cambiar el número de una cuota pagada'
      using errcode = '55006', hint = 'jouve_guard';
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
