SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W2 · S4 F2: taking back a rendición difference the driver's
-- account holds deletes its treasury movement too, so the actions now pass
-- p_allow_driver only with hr:write and transactions:write (the manual
-- "Adelanto a empleado" needs both). The refusal says so. Same signature and
-- body as 20261104095300; only the message changes.
--
-- Rollback: older code passes hr:write alone and gets the new message.

create or replace function public.remove_driver_settlement_difference(
  p_settlement_id uuid,
  p_user_id       uuid,
  p_allow_driver  boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movement public.employee_account_movements;
begin
  select * into v_movement
    from public.employee_account_movements
   where driver_settlement_id = p_settlement_id;

  if not p_allow_driver and (
    v_movement.id is not null
    or exists (
      select 1 from public.driver_settlement_difference_receipts
       where settlement_id = p_settlement_id
    )
  ) then
    raise exception 'La diferencia de la rendición está en la cuenta corriente del chofer: quitarla requiere permiso de escritura en RRHH y en movimientos.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  update public.receipts r
     set status = 'canceled',
         canceled_at = now(),
         canceled_by = p_user_id
    from public.driver_settlement_difference_receipts d
   where d.settlement_id = p_settlement_id
     and r.id = d.receipt_id
     and r.status = 'issued';
  delete from public.driver_settlement_difference_receipts
   where settlement_id = p_settlement_id;

  if v_movement.id is not null then
    delete from public.employee_account_movements where id = v_movement.id;
    if v_movement.transaction_id is not null then
      delete from public.transactions where id = v_movement.transaction_id;
    end if;
  end if;

  update public.driver_settlements
     set difference_charged_to = null
   where id = p_settlement_id
     and difference_charged_to is not null;
end;
$$;

-- Only unpost_driver_settlement_difference and cancel_driver_settlement call
-- it (they run as its owner): no API role, the
-- service role included, can skip their row lock or the p_allow_driver check.
revoke all on function public.remove_driver_settlement_difference(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
