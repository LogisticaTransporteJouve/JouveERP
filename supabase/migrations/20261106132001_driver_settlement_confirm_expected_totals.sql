SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Confirming a rendición de chofer posts what the driver handed in as
-- receipts and takes what he had to collect from each carga's contra-entrega
-- amount at that moment (confirm_driver_settlement). An assistant proposal
-- shows both totals before the user accepts it; a draft re-saved, or a
-- carga's amount edited, in between would post receipts the user never saw.
--
-- confirm_driver_settlement(uuid, uuid, numeric, numeric) is the confirm,
-- unchanged, that refuses when what it posted is not p_received_total or
-- what it expected is not p_expected_total. It runs the two-argument confirm
-- and then compares, in the same transaction, so a refusal rolls back the
-- receipts and the number. A rendición already confirmed returns its
-- receipts as before.
--
-- The two-argument confirm keeps its signature, body and grants: the app's
-- form and code deployed before this change call it.
--
-- Rollback: older code calls only the two-argument confirm, which this
-- migration does not touch; the new overload can stay.

create function public.confirm_driver_settlement(
  p_settlement_id  uuid,
  p_user_id        uuid,
  p_expected_total numeric,
  p_received_total numeric
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status   text;
  v_receipts uuid[];
  v_expected numeric;
  v_received numeric;
begin
  if p_expected_total is null or p_received_total is null then
    raise exception 'Faltan los totales que se confirman.'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  -- The same row lock the confirm takes, so the status read here is the one
  -- it confirms from.
  select ds.status
    into v_status
    from public.driver_settlements ds
   where ds.id = p_settlement_id
     for update;

  v_receipts := public.confirm_driver_settlement(p_settlement_id, p_user_id);

  if v_status = 'draft' then
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
    if round(v_expected, 2) <> round(p_expected_total, 2)
       or round(v_received, 2) <> round(p_received_total, 2) then
      raise exception 'La rendición cambió desde la propuesta (se editó un pago o el importe contra entrega de una carga): revisala y volvé a confirmarla.'
        using errcode = '22023', hint = 'jouve_guard';
    end if;
  end if;

  return v_receipts;
end;
$$;

comment on function public.confirm_driver_settlement(uuid, uuid, numeric, numeric) is
  'Confirma la rendición como confirm_driver_settlement(uuid, uuid) y la rechaza si lo que tenía que cobrar o lo que entregó no son los totales esperados.';

revoke all on function public.confirm_driver_settlement(uuid, uuid, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.confirm_driver_settlement(uuid, uuid, numeric, numeric)
  to service_role;
