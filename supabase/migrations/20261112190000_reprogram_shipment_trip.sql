SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- «Reprogramar carga» can put the carga on a trip of its new date in the same
-- step. reprogram_shipment(id, new date, motivo, comentario, trip): one
-- transaction that
--   1. reprograms through change_shipment_status (20261112120100: status,
--      motivo and history rows; an in_progress carga goes back to
--      not_started);
--   2. takes the carga off its current trip («Sale del viaje actual»);
--   3. when p_trip_id is given, puts it on that trip, which must be live
--      (not cancelled) and dated on the new date. A refused assignment
--      rolls the reprogramming back.
-- The status sync (sync_shipment_trip_status, «En curso» on a trip dated
-- today) runs after it from the app, as for every assignment.
-- SECURITY INVOKER: shipments' RLS decides who reaches the carga, and the
-- caller checks shipments:write (and trips:write for the trip).

create function public.reprogram_shipment(
  p_id             uuid,
  p_scheduled_date date,
  p_failure_reason text default null,
  p_comment        text default null,
  p_trip_id        uuid default null
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old  text;
  v_trip public.trips;
begin
  if p_scheduled_date is null then
    raise exception 'Indicá la nueva fecha.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if p_trip_id is not null then
    select * into v_trip from public.trips where id = p_trip_id;
    if v_trip.id is null or v_trip.status = 'cancelled' then
      raise exception 'El viaje elegido no existe o está cancelado.'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    if v_trip.trip_date <> p_scheduled_date then
      raise exception 'El viaje elegido no es de la nueva fecha de carga.'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
  end if;

  v_old := public.change_shipment_status(
    p_id, 'reprogrammed', p_comment, null, p_failure_reason, p_scheduled_date);

  update public.shipments
     set trip_id = p_trip_id
   where id = p_id
     and trip_id is distinct from p_trip_id;

  return v_old;
end;
$$;

comment on function public.reprogram_shipment(uuid, date, text, text, uuid) is
  'Reprograma una carga (change_shipment_status), la saca de su viaje y, si se indica, la asigna a un viaje vigente de la nueva fecha; todo o nada.';

revoke all on function public.reprogram_shipment(uuid, date, text, text, uuid) from public, anon;
grant execute on function public.reprogram_shipment(uuid, date, text, text, uuid) to authenticated, service_role;
