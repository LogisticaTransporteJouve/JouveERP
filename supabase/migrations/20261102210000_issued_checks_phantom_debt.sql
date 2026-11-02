SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Roadmap 0.7: issued checks no longer create phantom supplier debt.
--
--   1. emit_journal_for_issued_check_transition: rejecting or annulling a
--      check loaded by hand (no payment order) posted Dr cheques diferidos /
--      Cr proveedores, giving back a liability that was never booked. Such a
--      check now posts nothing on those transitions.
--   2. guard_issued_check_cancel_live_order: annulling a check whose payment
--      order is still issued gave the debt back once, and annulling the order
--      later reversed the order's entry and gave it back again. The check of a
--      live order is annulled with the order (or the order is edited); the
--      order's own cancellation still flips its checks, since that handler
--      runs after the order is already canceled. A rejection stays allowed:
--      the bank bounced it and the debt is really back.
--
-- Existing rows are not touched here; the doubled entries already posted are
-- listed in the PR as a follow-up (they may sit in closed periods).

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

  if new.status = 'cashed' then
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

create or replace function public.guard_issued_check_cancel_live_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_numero text;
begin
  if new.status = 'cancelled'
     and old.status is distinct from 'cancelled'
     and new.payment_order_id is not null then
    select po.numero::text into v_numero
      from public.payment_orders po
     where po.id = new.payment_order_id
       and po.status = 'issued';
    if found then
      raise exception
        'Este cheque es de la orden de pago %: anulá la orden o editala para cambiar el medio de pago.',
        coalesce(v_numero, '')
        using errcode = '55006', hint = 'jouve_guard';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_issued_check_cancel_live_order() from public, anon, authenticated;

drop trigger if exists guard_issued_check_cancel_live_order on public.issued_checks;
create trigger guard_issued_check_cancel_live_order
  before update of status on public.issued_checks
  for each row execute function public.guard_issued_check_cancel_live_order();
