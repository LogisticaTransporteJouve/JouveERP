SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Diferencia de la rendición en la cuenta corriente del chofer (follow-up
-- de 20261103090100_cod_driver_settlements + 20261103060100_employee_accounts).
--
--   1. employee_account_movements.driver_settlement_id: the movement a
--      confirmed rendición posted for its difference (Σ lo entregado − Σ lo
--      esperado). Short (negative) → 'charge': the driver owes it. Over
--      (positive) → 'payment': it credits the driver's account. One per
--      rendición (unique index), ARS, creditor empresa, no plan, no
--      treasury movement: like a manual movement it is the employee's
--      sub-ledger only (no journal entry, no Gestión figure), and a debt
--      plan or the planilla collects it as any other charge.
--   2. post_driver_settlement_difference: explicit (never at confirmation,
--      a shortfall can be the client's debt instead), under the rendición's
--      row lock, returns the same movement on a second call. Refuses a
--      rendición that is not confirmed, has no difference, a driver without
--      an employee, or a receipt cancelled or edited since (the difference
--      would be stale).
--      unpost_driver_settlement_difference deletes it (a no-op without one).
--   3. The movement is owned by the rendición: guard_employee_account_movement
--      refuses writing or deleting it from anywhere else (only the
--      description is editable, as for every movement),
--      delete_employee_account_movement refuses it, and
--      cancel_driver_settlement deletes it with the rendición.
--
-- Rollback: older code ignores the column; an older HR card lists the
-- movement as "Manual" and its delete is refused by this guard (message).

------------------------------------------------------------------------------
-- 1. Column
------------------------------------------------------------------------------

alter table public.employee_account_movements
  -- squawk-ignore adding-foreign-key-constraint
  add column driver_settlement_id uuid references public.driver_settlements (id) on delete restrict;

comment on column public.employee_account_movements.driver_settlement_id is
  'Rendición cuya diferencia asentó este movimiento (charge = faltante, payment = sobrante). Lo escriben post/unpost_driver_settlement_difference.';

-- The column is new and all null: the check validates at once.
alter table public.employee_account_movements
  add constraint employee_account_movements_driver_settlement check (
    driver_settlement_id is null
    or (kind in ('charge', 'payment')
        and currency = 'ARS'
        and plan_id is null
        and transaction_id is null
        and purchase_invoice_id is null
        and payroll_entry_id is null)
  ) not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.employee_account_movements validate constraint employee_account_movements_driver_settlement;

-- squawk-ignore require-concurrent-index-creation
create unique index employee_account_movements_driver_settlement_key
  on public.employee_account_movements (driver_settlement_id)
  where driver_settlement_id is not null;

------------------------------------------------------------------------------
-- 2. Ownership
------------------------------------------------------------------------------

-- Same as 20261103060100 plus the rendición: post/unpost write it, and
-- nothing else writes or deletes a movement with driver_settlement_id.
create or replace function public.guard_employee_account_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
  v_row   public.employee_account_movements;
  v_plan  public.employee_debt_plans;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  if tg_op <> 'DELETE' and new.plan_id is not null
     and (tg_op = 'INSERT' or new.plan_id is distinct from old.plan_id) then
    select * into v_plan from public.employee_debt_plans where id = new.plan_id;
    if v_plan.employee_id is distinct from new.employee_id
       or v_plan.currency is distinct from new.currency then
      raise exception 'El plan es de otro empleado o de otra moneda que el movimiento'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
  end if;

  -- The triggers that own movements (closed planilla, purchase, plan) and
  -- the RPCs write them; nothing else writes an owned one.
  get diagnostics v_stack = pg_context;
  if pg_trigger_depth() > 1
     or v_stack ~ 'function (public\.)?(record_employee_account_cash|delete_employee_account_movement|post_driver_settlement_difference|unpost_driver_settlement_difference|cancel_driver_settlement)\(' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'description' - 'updated_at') <> (to_jsonb(old) - 'description' - 'updated_at') then
      raise exception 'De un movimiento de la cuenta corriente solo se edita la descripción: borralo y cargalo de nuevo'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    return new;
  end if;

  if v_row.transaction_id is not null
     or v_row.purchase_invoice_id is not null
     or v_row.payroll_entry_id is not null
     or v_row.driver_settlement_id is not null
     or v_row.kind = 'forgiveness' then
    raise exception '%', case
        when v_row.payroll_entry_id is not null
          then 'El descuento de planilla lo escribe el cierre del período: reabrilo para cambiarlo'
        when v_row.purchase_invoice_id is not null
          then 'El cargo de una compra se maneja desde la compra (a cargo de empleado)'
        when v_row.driver_settlement_id is not null
          then 'La diferencia de una rendición se asienta o se quita desde la rendición'
        when v_row.kind = 'forgiveness'
          then 'La condonación la escribe el plan al marcarlo condonado'
        else 'Un adelanto o pago en caja se registra o se borra desde la cuenta corriente del empleado, junto con su movimiento de caja'
      end
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.guard_employee_account_movement() from public, anon, authenticated;

-- Same as 20261103060100 plus refusing a rendición's difference.
create or replace function public.delete_employee_account_movement(p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movement public.employee_account_movements;
begin
  -- Role guard (hr:write holders in lib/auth/permissions.ts).
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para borrar movimientos de la cuenta corriente de empleados'
      using errcode = '42501';
  end if;

  select * into v_movement from public.employee_account_movements where id = p_movement_id for update;
  if v_movement.id is null then
    raise exception 'El movimiento no existe'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if v_movement.payroll_entry_id is not null then
    raise exception 'El descuento de planilla lo escribe el cierre del período: reabrilo para cambiarlo'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if v_movement.purchase_invoice_id is not null then
    raise exception 'El cargo de una compra se maneja desde la compra (a cargo de empleado)'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if v_movement.driver_settlement_id is not null then
    raise exception 'La diferencia de una rendición se quita desde la rendición'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if v_movement.kind = 'forgiveness' then
    raise exception 'La condonación de un plan no se borra'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  -- An advance's plan is the one it opened: it goes with the advance unless
  -- something already paid it back.
  if v_movement.kind = 'advance' and v_movement.plan_id is not null and exists (
    select 1 from public.employee_account_movements
     where plan_id = v_movement.plan_id and id <> v_movement.id
  ) then
    raise exception 'El plan de este adelanto ya tiene descuentos o pagos: cancelá el plan en vez de borrar el adelanto'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  delete from public.employee_account_movements where id = v_movement.id;
  if v_movement.transaction_id is not null then
    delete from public.transactions where id = v_movement.transaction_id;
  end if;
  if v_movement.kind = 'advance' and v_movement.plan_id is not null then
    delete from public.employee_debt_plans where id = v_movement.plan_id;
  end if;
end;
$$;

comment on function public.delete_employee_account_movement(uuid) is
  'Borra un movimiento manual de la cuenta corriente, o un adelanto / pago en caja junto con su movimiento de caja.';

revoke all on function public.delete_employee_account_movement(uuid) from public, anon, authenticated;
grant execute on function public.delete_employee_account_movement(uuid) to authenticated, service_role;

------------------------------------------------------------------------------
-- 3. Post / unpost
------------------------------------------------------------------------------

create function public.post_driver_settlement_difference(
  p_settlement_id uuid,
  p_user_id       uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s          record;
  v_existing   uuid;
  v_expected   numeric;
  v_received   numeric;
  v_difference numeric;
  v_id         uuid;
begin
  select ds.status, ds.numero, ds.settlement_date, d.employee_id, d.full_name
    into v_s
    from public.driver_settlements ds
    join public.drivers d on d.id = ds.driver_id
   where ds.id = p_settlement_id
     for update of ds;
  if not found then
    raise exception 'La rendición no existe.'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;

  select m.id into v_existing
    from public.employee_account_movements m
   where m.driver_settlement_id = p_settlement_id;
  if found then
    return v_existing;
  end if;

  if v_s.status <> 'confirmed' then
    raise exception 'Solo se asienta la diferencia de una rendición confirmada.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if v_s.employee_id is null then
    raise exception 'El chofer % no está vinculado a un empleado: vinculalo en Flota › Choferes.', v_s.full_name
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  -- A receipt cancelled or edited in Recibos makes the difference stale.
  if exists (
    select 1
      from public.driver_settlement_lines l
      join public.driver_settlement_items i on i.id = l.item_id
      join public.receipts r on r.id = l.receipt_id
     where i.settlement_id = p_settlement_id
     group by r.id, r.status, r.total_amount
    having r.status <> 'issued' or r.total_amount <> sum(l.amount)
  ) then
    raise exception 'Un recibo de la rendición se anuló o se editó en Recibos: revisala antes de asentar la diferencia.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  select coalesce(sum(i.expected_amount), 0)
    into v_expected
    from public.driver_settlement_items i
   where i.settlement_id = p_settlement_id
     and not i.released;
  select coalesce(sum(l.amount), 0)
    into v_received
    from public.driver_settlement_lines l
    join public.driver_settlement_items i on i.id = l.item_id
   where i.settlement_id = p_settlement_id
     and not i.released;
  v_difference := round(v_received - v_expected, 2);
  if v_difference = 0 then
    raise exception 'La rendición no tiene diferencia: no hay nada que asentar.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  insert into public.employee_account_movements (
    employee_id, kind, currency, amount, movement_date, description,
    creditor, driver_settlement_id, created_by
  ) values (
    v_s.employee_id,
    case when v_difference < 0 then 'charge' else 'payment' end,
    'ARS',
    abs(v_difference),
    v_s.settlement_date,
    'Rendición N° ' || v_s.numero || ' — '
      || case when v_difference < 0 then 'faltante' else 'sobrante' end
      || ' de cobranza contra entrega',
    'empresa',
    p_settlement_id,
    p_user_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.post_driver_settlement_difference(uuid, uuid) is
  'Asienta la diferencia de una rendición confirmada en la cuenta corriente del chofer (faltante = charge, sobrante = payment). Idempotente.';

revoke all on function public.post_driver_settlement_difference(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.post_driver_settlement_difference(uuid, uuid)
  to service_role;

create function public.unpost_driver_settlement_difference(p_settlement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
    from public.driver_settlements ds
   where ds.id = p_settlement_id
     for update;
  if not found then
    raise exception 'La rendición no existe.'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  delete from public.employee_account_movements
   where driver_settlement_id = p_settlement_id;
end;
$$;

comment on function public.unpost_driver_settlement_difference(uuid) is
  'Quita de la cuenta corriente del chofer la diferencia asentada de una rendición (no-op si no hay).';

revoke all on function public.unpost_driver_settlement_difference(uuid)
  from public, anon, authenticated;
grant execute on function public.unpost_driver_settlement_difference(uuid)
  to service_role;

-- Same as 20261103090100 plus deleting the difference it posted.
create or replace function public.cancel_driver_settlement(
  p_settlement_id uuid,
  p_user_id       uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select ds.status
    into v_status
    from public.driver_settlements ds
   where ds.id = p_settlement_id
     for update;
  if not found then
    raise exception 'La rendición no existe.'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if v_status = 'cancelled' then
    return;
  end if;

  update public.driver_settlements
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = p_user_id
   where id = p_settlement_id;

  update public.driver_settlement_items
     set released = true
   where settlement_id = p_settlement_id
     and not released;

  delete from public.employee_account_movements
   where driver_settlement_id = p_settlement_id;
end;
$$;

revoke all on function public.cancel_driver_settlement(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_driver_settlement(uuid, uuid)
  to service_role;
