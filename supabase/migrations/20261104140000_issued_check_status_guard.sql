SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W7 · S2 F1: an own check leaves 'emitted' once. Every money
-- trigger on issued_checks fires on old.status = 'emitted'
-- (issued_check_cashed_outflow, issued_check_rejected_inflow,
-- emit_journal_for_issued_check_transition) and trusts that the check never
-- left it before. RLS lets owner, admin and finance PATCH every column, so
-- {"status":"emitted","cashed_at":null} on an order's cashed check, then
-- «Cobrado» again, posted the cashing entry twice; «Rechazado» instead booked
-- a bank inflow and a reversal for a check the bank paid; and cashed →
-- rejected made the supplier owe it (v_supplier_rejected_check_open).
--
-- The writers only move a check out of 'emitted':
-- transitionIssuedCheckAction (filtered on status = 'emitted') and
-- handle_payment_order_cancellation (emitted → cancelled). Both insert paths
-- («Nuevo cheque emitido» and the order RPCs) insert it emitted. So the status
-- changes only from 'emitted', and a check is inserted emitted. Existing rows
-- are not touched.
--
-- Rollback: older code makes only those transitions, so it is unaffected.

-- Same as 20261104123000 plus the two status rules.
create or replace function public.guard_issued_check_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'emitted' then
      raise exception 'Un cheque propio se carga emitido: el cobro, el rechazo o la anulación se registran después desde el cheque'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    if new.payment_order_id is not null then
      get diagnostics v_stack = pg_context;
      if v_stack !~ 'function (public\.)?(create_payment_order|update_payment_order)\(' then
        raise exception 'Un cheque propio se liga a una orden de pago solo cargándolo desde la orden de pago'
          using errcode = '55006', hint = 'jouve_guard';
      end if;
    end if;
    return new;
  end if;

  if new.status is distinct from old.status and old.status <> 'emitted' then
    raise exception 'El cheque ya no está emitido: se cobró, se rechazó o se anuló, y ese estado no se cambia'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if old.payment_order_id is not null
     and (new.payment_order_id is distinct from old.payment_order_id
       or new.amount          is distinct from old.amount
       or new.currency        is distinct from old.currency
       or new.bank_account_id is distinct from old.bank_account_id) then
    raise exception 'El cheque está ligado a una orden de pago: el monto, la moneda, la cuenta y la OP se cambian editando la orden de pago'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
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
