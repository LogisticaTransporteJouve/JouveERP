SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- An account's currency, type and opening balance are frozen once it has
-- movements (audit w2-s2 F5).
--
-- Editing them on an account with history revalued every past movement (a
-- peso history read as dollars), moved every past balance at once with no
-- ledger counterpart (including the book balance of reconciled periods), or
-- broke the cartera = Σ checks invariant (bank ↔ checks).
--
--   1. account_has_movements(id): the account holds a treasury movement, a
--      third-party check in cartera, an own check drawn on it, a bank
--      statement line or an opening-balance adjustment. For the edit form
--      (service_role) and for the guard.
--   2. guard_account_currency_change (20261102240000, same message for the
--      currency) also covers type and opening_balance, with the predicate of
--      1. A level change goes through the dated adjustment
--      (apply_account_opening_balance), which leaves a movement and an
--      asiento. The trigger now fires on the three columns.
--
-- Existing rows are not touched. Rollback: older code issues the same
-- update; an edit it allowed on an account with movements now gets the
-- guard's message.

create function public.account_has_movements(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.transactions t where t.account_id = p_account_id)
      or exists (select 1 from public.checks c where c.cartera_account_id = p_account_id)
      or exists (select 1 from public.issued_checks ic where ic.bank_account_id = p_account_id)
      or exists (select 1 from public.bank_statement_lines l where l.account_id = p_account_id)
      or exists (select 1 from public.account_opening_balances o where o.account_id = p_account_id)
$$;

comment on function public.account_has_movements(uuid) is
  'La cuenta tiene movimientos, cheques, extractos o un ajuste de saldo inicial: su moneda, tipo y saldo inicial quedan fijos.';

revoke all on function public.account_has_movements(uuid) from public, anon, authenticated;
grant execute on function public.account_has_movements(uuid) to service_role;

create or replace function public.guard_account_currency_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.currency is distinct from old.currency
      or new.type is distinct from old.type
      or new.opening_balance is distinct from old.opening_balance)
     and public.account_has_movements(old.id) then
    if new.currency is distinct from old.currency then
      raise exception 'No se puede cambiar la moneda de una cuenta con movimientos: creá otra cuenta en %', new.currency
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    if new.type is distinct from old.type then
      raise exception 'No se puede cambiar el tipo de una cuenta con movimientos: creá otra cuenta del tipo que necesitás'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    raise exception 'No se puede cambiar el saldo inicial de una cuenta con movimientos: usá "Ajustar saldo", que lo corrige con fecha'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_account_currency_change() from public, anon, authenticated;

drop trigger accounts_guard_currency_change on public.accounts;

create trigger accounts_guard_currency_change
  before update of currency, type, opening_balance on public.accounts
  for each row execute function public.guard_account_currency_change();
