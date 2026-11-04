SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W8 · S4 F2 and S5 F1.
--
-- 1. A cuota is paid only by its RPC. RLS lets owner, admin and finance PATCH
--    every column of loan_installments, and guard_loan_installment_paid
--    (20261103040100) pins the amounts and the movement only once a cuota is
--    paid. A PATCH could mark a cuota paid with no outflow, put a paid cuota
--    back to pending (so «Pagar» booked a second outflow and a second capital
--    entry) or tie a pending cuota to any movement, skipping every check of
--    adopt_loan_installment_payment; the movement then became owned
--    (guard_transaction_owned_by_document) and re-posted as loan capital
--    (build_transaction_journal_lines).
--
--    The writers, latest definitions: pay_loan_installment and
--    adopt_loan_installment_payment (20261103040100) are the only statements
--    that change status, paid_date, paid_amount or transaction_id, and only
--    on a pending cuota. The app edits amount, due date, notes and the split
--    of a pending cuota (updateInstallmentAction). Every inserter inserts
--    pending rows with none of those columns: createLoanAction (now
--    create_loan, below) and commit_import_run (20261104070000). The FK
--    transaction_id on delete set null runs at pg_trigger_depth() > 1 and
--    carries no caller values. undo_import_run and the loan's delete cascade
--    only delete.
--
--    guard_loan_installment_payment (before insert or update):
--    - an insert is pending, with no paid date, paid amount or movement;
--    - status, paid_date, paid_amount and transaction_id change only inside
--      pay_loan_installment / adopt_loan_installment_payment (pg_context, as
--      guard_document_line does) or from a foreign-key action.
--    Its trigger fires after loan_installments_guard_paid (name order), so the
--    paid-cuota message still wins.
--
-- 2. A loan's disbursement link is set only by record_loan_disbursement.
--    guard_loan (20261104093200) refused a change of a link already set, but
--    null → any id passed, skipping the channel, currency and amount checks
--    of record_loan_disbursement. Same function plus: null → value only
--    inside record_loan_disbursement, and an insert carries no link (no
--    writer inserts one). The insert runs through its own trigger.
--
-- 3. create_loan inserts the loan and its schedule in one transaction.
--    createLoanAction wrote them in two commits and "rolled back" with a
--    client-side delete, so a failure or a kill between them left a loan with
--    no cuotas. Same columns and values as the action wrote, the same role
--    check as the other loan RPCs (accounting:write holders), and the
--    schedule must have installments_count rows, as the importer requires.
--
-- The RLS policies are not changed. Existing rows are not touched.
--
-- Rollback: older code changes these columns only through those RPCs, inserts
-- pending cuotas and no disbursement link, so it is unaffected; it inserts
-- loans and cuotas directly, which stays allowed.

-- 1. Cuota payment columns ------------------------------------------------------

create function public.guard_loan_installment_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
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

create trigger loan_installments_guard_payment
  before insert or update on public.loan_installments
  for each row execute function public.guard_loan_installment_payment();

-- 2. Disbursement link ------------------------------------------------------------

-- Same as 20261104093200 plus the insert and the null → value rules.
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
  return new;
end;
$$;

revoke all on function public.guard_loan() from public, anon, authenticated;

create trigger loans_guard_insert
  before insert on public.loans
  for each row execute function public.guard_loan();

-- 3. Creating a loan with its schedule ----------------------------------------------

create function public.create_loan(p_loan jsonb, p_installments jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan_id uuid;
  v_count   int := (p_loan ->> 'installments_count')::int;
begin
  -- Role guard (accounting:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para crear préstamos'
      using errcode = '42501';
  end if;

  if p_installments is null
     or jsonb_typeof(p_installments) <> 'array'
     or jsonb_array_length(p_installments) is distinct from v_count then
    raise exception 'El cronograma no coincide con la cantidad de cuotas del préstamo'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  insert into public.loans (
    kind, description, lender, principal, currency, channel_id,
    installments_count, first_due_date, notes, created_by
  ) values (
    (p_loan ->> 'kind')::public.loan_kind,
    p_loan ->> 'description',
    p_loan ->> 'lender',
    (p_loan ->> 'principal')::numeric,
    p_loan ->> 'currency',
    p_loan ->> 'channel_id',
    v_count,
    (p_loan ->> 'first_due_date')::date,
    p_loan ->> 'notes',
    auth.uid()
  )
  returning id into v_loan_id;

  insert into public.loan_installments (loan_id, number, due_date, amount)
  select v_loan_id, i.number, i.due_date, i.amount
    from jsonb_to_recordset(p_installments) as i(
           number integer, due_date date, amount numeric
         );

  return v_loan_id;
end;
$$;

revoke all on function public.create_loan(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_loan(jsonb, jsonb) to authenticated, service_role;
