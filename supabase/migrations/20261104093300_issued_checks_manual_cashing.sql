SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W1 · S2 F7 and F8: own checks loaded by hand (no payment order).
--
--   1. emit_journal_for_issued_check_transition (F7): cashing a hand-loaded
--      check debited cheques_diferidos_emitidos, a liability nothing ever
--      credited for it (only a payment order books it), so the account went
--      into debit and the payment never reached the P&L. It now posts
--      Dr <the supplier's default expense account, or gastos> / Cr banco, the
--      same counterpart a loose expense to that supplier gets, in pesos (a
--      USD check at the rate of its cashing day; no rate, no entry). A check
--      from a payment order posts as before.
--   2. guard_issued_check_edit (F8): once a check leaves 'emitted' its amount,
--      currency and bank account are frozen (the cashing movement and entry
--      were booked with them and are immutable), and a payment order can be
--      attached to a check only by the payment order RPCs, which insert the
--      check with it. Linking a hand-loaded check to an order made its
--      cashing write no bank outflow (the order's lines never had it).
--
-- Existing rows are not touched: hand-loaded checks already cashed keep their
-- entry (docs/pendientes.md).
--
-- Rollback: older code issues the same updates; an edit it allowed after
-- cashing now gets the guard's message.

-- Same as 20261102210000 plus the cashing of a hand-loaded check.
create or replace function public.emit_journal_for_issued_check_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bank_role public.coa_system_role;
  v_lines     jsonb;
  v_desc      text;
  v_amount    numeric;
  v_period    text;
  v_expense   uuid;
begin
  -- Solo procesamos transiciones desde emitted.
  if old.status <> 'emitted' then
    return new;
  end if;
  if new.status not in ('cashed', 'rejected', 'cancelled') then
    return new;
  end if;

  if new.channel_id is not null and not public.is_channel_fiscal(new.channel_id) then
    return new;
  end if;

  -- A hand-loaded check (no payment order) never booked a supplier liability:
  -- rejecting or annulling it has nothing to give back.
  if new.payment_order_id is null and new.status in ('rejected', 'cancelled') then
    return new;
  end if;

  if new.status = 'cancelled' and exists (
    select 1 from public.payment_orders po
     where po.id = new.payment_order_id and po.status = 'canceled'
  ) then
    return new;
  end if;

  -- Cuenta bancaria mapeada
  v_bank_role := public.coa_role_for_account(new.bank_account_id);
  if v_bank_role is null then
    raise warning 'emit_journal_for_issued_check: bank_account % sin COA role', new.bank_account_id;
    return new;
  end if;

  v_amount := new.amount;
  v_period := to_char(coalesce(new.cashed_at, now())::date, 'YYYY-MM');

  if new.status = 'cashed' and new.payment_order_id is null then
    -- A hand-loaded check is the payment itself: it has no liability to
    -- reverse, so it is an expense (the supplier's default account, if any).
    -- The journal is in pesos: a USD check posts at the rate of its cashing
    -- day (the date of its bank outflow), and with no rate it posts nothing.
    if new.currency = 'USD' then
      v_amount := round(new.amount * public.get_exchange_rate('USD', coalesce(new.cashed_at, now())::date), 2);
      if v_amount is null then
        raise warning 'emit_journal_for_issued_check: sin cotización USD (issued_check=%)', new.id;
        return new;
      end if;
    end if;
    v_desc := 'Cobro cheque propio #' || new.check_number || ' ' || new.bank_name;
    select s.default_expense_account_id into v_expense
      from public.suppliers s
     where s.id = new.supplier_id;
    v_lines := jsonb_build_array(
      case when v_expense is not null
        then jsonb_build_object('account_id', v_expense, 'debit', v_amount, 'description', v_desc || ' — gasto')
        else jsonb_build_object('system_role', 'gastos', 'debit', v_amount, 'description', v_desc || ' — gasto')
      end,
      jsonb_build_object('system_role', v_bank_role::text, 'credit', v_amount, 'description', v_desc || ' — egreso banco')
    );
  elsif new.status = 'cashed' then
    v_desc := 'Cobro cheque propio #' || new.check_number || ' ' || new.bank_name;
    v_lines := jsonb_build_array(
      jsonb_build_object('system_role', 'cheques_diferidos_emitidos', 'debit', v_amount, 'description', v_desc || ' — revierte pasivo'),
      jsonb_build_object('system_role', v_bank_role::text,            'credit', v_amount, 'description', v_desc || ' — egreso banco')
    );
  else
    -- rejected / cancelled: la obligación con el proveedor vuelve a aparecer.
    v_desc := case new.status
      when 'rejected'  then 'Rechazo cheque propio #'
      when 'cancelled' then 'Anulación cheque propio #'
    end || new.check_number || ' ' || new.bank_name;
    v_lines := jsonb_build_array(
      jsonb_build_object('system_role', 'cheques_diferidos_emitidos', 'debit',  v_amount, 'description', v_desc || ' — revierte pasivo'),
      jsonb_build_object('system_role', 'proveedores',                'credit', v_amount, 'description', v_desc || ' — deuda vuelve a aparecer')
    );
  end if;

  begin
    perform public.create_journal_entry(
      p_entry_date     := coalesce(new.cashed_at, now())::date,
      p_accrual_period := v_period,
      p_description    := v_desc,
      p_lines          := v_lines,
      p_source_table   := 'issued_checks',
      p_source_id      := new.id,
      p_channel_id     := new.channel_id
    );
  exception when sqlstate 'P0002' then
    raise warning 'emit_journal_for_issued_check: % (issued_check=%)', sqlerrm, new.id;
  end;

  return new;
end;
$$;

revoke all on function public.emit_journal_for_issued_check_transition() from public, anon, authenticated;

create function public.guard_issued_check_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

create trigger issued_checks_guard_edit
  before update on public.issued_checks
  for each row execute function public.guard_issued_check_edit();
