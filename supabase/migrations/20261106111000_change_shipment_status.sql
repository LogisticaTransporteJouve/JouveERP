SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- change_shipment_status: a carga's status change and its history row in one
-- transaction. changeShipmentStatusAction used to read the status, update the
-- row without re-checking it, and insert the history row afterwards; a failed
-- history insert was only logged, so the status changed with no trace, and a
-- concurrent change left a stale old_status.
--
-- The row is locked first, so old_status is the status the change really left
-- and two changes run one after the other. The transitions are the ones the
-- cargas table offers (STATUS_ACTIONS in
-- features/shipments/components/shipments-table.tsx):
--   not_started  → in_progress, delivered, cancelled, reprogrammed
--   in_progress  → delivered, cancelled, reprogrammed
--   cancelled    → reprogrammed
--   reprogrammed → reprogrammed (a new date)
--   delivered    → nothing
-- Any other one (a stale table, a double click) is refused with the guard's
-- message and writes nothing.
--
-- SECURITY INVOKER, called with the user's client: shipments' and the
-- history's RLS apply as before, a row the caller cannot see reads as not
-- found, and the history row carries auth.uid().
--
-- Rollback: older code does not call it and writes the two rows itself.

create function public.change_shipment_status(
  p_id             uuid,
  p_status         text,
  p_comment        text default null,
  p_delivery_date  date default null,
  p_failure_reason text default null,
  p_scheduled_date date default null
)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_old text;
begin
  select s.status into v_old
    from public.shipments s
   where s.id = p_id
     for update;
  if not found then
    raise exception 'No se encontró la carga.'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;

  if not (
       (v_old = 'not_started' and p_status in ('in_progress', 'delivered', 'cancelled', 'reprogrammed'))
    or (v_old = 'in_progress' and p_status in ('delivered', 'cancelled', 'reprogrammed'))
    or (v_old in ('cancelled', 'reprogrammed') and p_status = 'reprogrammed')
  ) then
    raise exception 'La carga cambió de estado mientras tanto: actualizá la lista y volvé a intentarlo.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  update public.shipments
     set status = p_status,
         delivery_date = case when p_status = 'delivered'
                              then p_delivery_date else delivery_date end,
         failure_reason = case when p_status in ('cancelled', 'reprogrammed')
                               then p_failure_reason else failure_reason end,
         scheduled_date = case when p_status = 'reprogrammed' and p_scheduled_date is not null
                               then p_scheduled_date else scheduled_date end
   where id = p_id;

  insert into public.shipment_status_history
    (shipment_id, old_status, new_status, comment, changed_by)
  values
    (p_id, v_old, p_status, p_comment, auth.uid());

  return v_old;
end;
$$;

comment on function public.change_shipment_status(uuid, text, text, date, text, date) is
  'Cambia el estado de una carga y registra el cambio en su historial, en una transacción. Rechaza una transición que no corresponde al estado actual. Devuelve el estado anterior.';

revoke all on function public.change_shipment_status(uuid, text, text, date, text, date) from public, anon, authenticated;
grant execute on function public.change_shipment_status(uuid, text, text, date, text, date) to authenticated, service_role;
