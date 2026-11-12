SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A carga on a trip starts by itself: no one presses «Iniciar».
--
-- 1. sync_shipment_trip_status(ids, actor): the system writer of the carga
--    status. Forward, over every carga (ids null) or the given ones: a
--    not_started or reprogrammed carga on a trip that is not cancelled and is
--    dated today or earlier (Argentina time) becomes in_progress. Backward,
--    only over the given ids (the cargas an action just moved): an
--    in_progress carga with no trip, on a trip dated after today or on a
--    cancelled trip goes back to not_started. Legacy in_progress cargas with
--    no trip are never touched by the daily run (ids null). One history row
--    per change, changed_by = the actor (null for the daily run). A carga a
--    guard freezes (a live settlement) keeps its status and does not sink the
--    others. Returns how many cargas changed. SECURITY DEFINER, service_role
--    only: the daily Inngest run and the trip/assignment actions after their
--    own permission checks.
-- 2. change_shipment_status (20261106111000), copied whole: reprogramming an
--    in_progress carga requires the new date, sends it back to not_started
--    and takes it off its trip (it can go on another one), with two history
--    rows (in_progress → reprogrammed, reprogrammed → not_started). Every
--    other transition is unchanged.
--
-- Rollback: older code never calls the sync; it still finds in_progress in
-- the CHECK and calls change_shipment_status with the same arguments.

create function public.sync_shipment_trip_status(
  p_shipment_ids uuid[] default null,
  p_actor        uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today   date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_row     record;
  v_changed integer := 0;
begin
  for v_row in
    select s.id,
           s.status as old_status,
           case when s.status = 'in_progress' then 'not_started' else 'in_progress' end as new_status
      from public.shipments s
      left join public.trips t on t.id = s.trip_id
     where (p_shipment_ids is null or s.id = any (p_shipment_ids))
       and (
            (s.status in ('not_started', 'reprogrammed')
             and t.id is not null
             and t.trip_date <= v_today
             and t.status <> 'cancelled')
         or (p_shipment_ids is not null
             and s.status = 'in_progress'
             and (t.id is null or t.trip_date > v_today or t.status = 'cancelled'))
       )
     order by s.id
       for update of s
  loop
    begin
      update public.shipments
         set status = v_row.new_status
       where id = v_row.id;

      insert into public.shipment_status_history
        (shipment_id, old_status, new_status, comment, changed_by)
      values
        (v_row.id, v_row.old_status, v_row.new_status,
         case when v_row.new_status = 'in_progress'
              then 'Automático: llegó la fecha del viaje'
              else 'Automático: la carga ya no está en un viaje de hoy' end,
         p_actor);

      v_changed := v_changed + 1;
    exception when sqlstate '55006' then
      -- A guard froze this carga (it is in a live settlement): it keeps its
      -- status and the rest still move.
      null;
    end;
  end loop;

  return v_changed;
end;
$$;

comment on function public.sync_shipment_trip_status(uuid[], uuid) is
  'Pone En curso las cargas de un viaje con fecha de hoy o anterior (hora argentina) y, solo para las cargas indicadas, vuelve a No iniciada las que ya no están en un viaje de hoy. Registra cada cambio en el historial. Devuelve cuántas cargas cambiaron.';

revoke all on function public.sync_shipment_trip_status(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.sync_shipment_trip_status(uuid[], uuid) to service_role;

-- The transitions (the cargas table offers them; the daily sync owns
-- not_started/reprogrammed → in_progress):
--   not_started  → in_progress, delivered, cancelled, reprogrammed
--   in_progress  → delivered, cancelled, reprogrammed (back to not_started,
--                  off its trip, with a new date)
--   cancelled    → reprogrammed
--   reprogrammed → reprogrammed (a new date)
--   delivered    → nothing
create or replace function public.change_shipment_status(
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

  if v_old = 'in_progress' and p_status = 'reprogrammed' then
    if p_scheduled_date is null then
      raise exception 'Indicá la nueva fecha.'
        using errcode = '23514', hint = 'jouve_guard';
    end if;

    update public.shipments
       set status = 'not_started',
           trip_id = null,
           failure_reason = p_failure_reason,
           scheduled_date = p_scheduled_date
     where id = p_id;

    -- clock_timestamp: the history lists newest first, so the two rows of
    -- one change need distinct, ordered times.
    insert into public.shipment_status_history
      (shipment_id, old_status, new_status, comment, changed_by, changed_at)
    values
      (p_id, v_old, 'reprogrammed', p_comment, auth.uid(), clock_timestamp());
    insert into public.shipment_status_history
      (shipment_id, old_status, new_status, comment, changed_by, changed_at)
    values
      (p_id, 'reprogrammed', 'not_started', 'Vuelve a No iniciada y sale del viaje', auth.uid(), clock_timestamp());

    return v_old;
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
  'Cambia el estado de una carga y registra el cambio en su historial, en una transacción. Rechaza una transición que no corresponde al estado actual. Reprogramar una carga En curso la vuelve a No iniciada y la saca de su viaje. Devuelve el estado anterior.';

revoke all on function public.change_shipment_status(uuid, text, text, date, text, date) from public, anon, authenticated;
grant execute on function public.change_shipment_status(uuid, text, text, date, text, date) to authenticated, service_role;
