SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W1 · S2 F6: cancelling (or deleting) a loan left its money
-- behind. The loan read "anulado" while its disbursement and its paid cuotas
-- stayed in Caja and the ledger, owned by a loan that no longer exists for
-- the user, and the owned-movement guard refuses to delete them. RLS also let
-- a writer clear disbursement_transaction_id and turn the movement loose.
--
-- guard_loan (before update or delete on loans):
--   - a loan with its disbursement recorded or any cuota paid cannot be
--     cancelled or deleted;
--   - disbursement_transaction_id cannot change once set.
-- A loan entered by mistake with nothing recorded is still cancelled as
-- before. One with money recorded is closed by paying it off (or, for a
-- disbursement entered by mistake, the owner fixes it at the source).
--
-- Rollback: older code issues the same update; it now gets the guard's message
-- instead of leaving the movements orphaned.

create function public.guard_loan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.disbursement_transaction_id is not null
     and new.disbursement_transaction_id is distinct from old.disbursement_transaction_id then
    raise exception 'El desembolso registrado de un préstamo no se puede cambiar'
      using errcode = '55006', hint = 'jouve_guard';
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

create trigger loans_guard
  before update or delete on public.loans
  for each row execute function public.guard_loan();
