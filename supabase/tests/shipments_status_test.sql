-- sync_shipment_trip_status and change_shipment_status (20261112120100): a
-- carga on a trip dated today or earlier starts by itself; the backward move
-- only touches the cargas passed; reprogramming an En curso carga sends it
-- back to No iniciada, off its trip. One transaction, rolled back.

begin;

select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000006a1', 'ops@shipment-sync.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000006a1', 'operations');

insert into public.trips (id, trip_date, status) values
  ('00000000-0000-0000-0000-0000000006c1',
   (now() at time zone 'America/Argentina/Buenos_Aires')::date, 'planned'),
  ('00000000-0000-0000-0000-0000000006c2',
   (now() at time zone 'America/Argentina/Buenos_Aires')::date + 3, 'planned'),
  ('00000000-0000-0000-0000-0000000006c3',
   (now() at time zone 'America/Argentina/Buenos_Aires')::date - 1, 'cancelled');

insert into public.shipments (id, status, trip_id) values
  -- on today's trip
  ('00000000-0000-0000-0000-0000000006b1', 'not_started', '00000000-0000-0000-0000-0000000006c1'),
  ('00000000-0000-0000-0000-0000000006b2', 'reprogrammed', '00000000-0000-0000-0000-0000000006c1'),
  -- on a future trip
  ('00000000-0000-0000-0000-0000000006b3', 'not_started', '00000000-0000-0000-0000-0000000006c2'),
  -- on a cancelled trip
  ('00000000-0000-0000-0000-0000000006b4', 'not_started', '00000000-0000-0000-0000-0000000006c3'),
  -- legacy En curso with no trip
  ('00000000-0000-0000-0000-0000000006b5', 'in_progress', null);

select ok(
  has_function_privilege('service_role', 'public.sync_shipment_trip_status(uuid[], uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.sync_shipment_trip_status(uuid[], uuid)', 'execute')
  and not has_function_privilege('anon', 'public.sync_shipment_trip_status(uuid[], uuid)', 'execute'),
  'only service_role runs sync_shipment_trip_status'
);

select is(public.sync_shipment_trip_status(), 2, 'the daily run starts the two cargas of today''s trip');

select results_eq(
  $$select id::text, status from public.shipments
     where id::text like '00000000-0000-0000-0000-0000000006b%' order by id$$,
  $$values ('00000000-0000-0000-0000-0000000006b1', 'in_progress'::text),
           ('00000000-0000-0000-0000-0000000006b2', 'in_progress'::text),
           ('00000000-0000-0000-0000-0000000006b3', 'not_started'::text),
           ('00000000-0000-0000-0000-0000000006b4', 'not_started'::text),
           ('00000000-0000-0000-0000-0000000006b5', 'in_progress'::text)$$,
  'future and cancelled trips do not start; the legacy En curso carga is untouched'
);

select results_eq(
  $$select old_status, new_status, comment, changed_by from public.shipment_status_history
     where shipment_id = '00000000-0000-0000-0000-0000000006b1'$$,
  $$values ('not_started'::text, 'in_progress'::text,
            'Automático: llegó la fecha del viaje'::text, null::uuid)$$,
  'each start writes one history row with no actor'
);

select is(public.sync_shipment_trip_status(), 0, 'a second run changes nothing');

-- The trip moves to a later date: only the cargas passed go back.
update public.trips
   set trip_date = (now() at time zone 'America/Argentina/Buenos_Aires')::date + 5
 where id = '00000000-0000-0000-0000-0000000006c1';

select is(public.sync_shipment_trip_status(), 0, 'the daily run never moves a carga backward');

select is(
  public.sync_shipment_trip_status(
    array['00000000-0000-0000-0000-0000000006b1'::uuid, '00000000-0000-0000-0000-0000000006b5'::uuid],
    '00000000-0000-0000-0000-0000000006a1'),
  2,
  'the passed cargas off a trip of today go back'
);

select results_eq(
  $$select id::text, status from public.shipments
     where id in ('00000000-0000-0000-0000-0000000006b1', '00000000-0000-0000-0000-0000000006b2',
                  '00000000-0000-0000-0000-0000000006b5') order by id$$,
  $$values ('00000000-0000-0000-0000-0000000006b1', 'not_started'::text),
           ('00000000-0000-0000-0000-0000000006b2', 'in_progress'::text),
           ('00000000-0000-0000-0000-0000000006b5', 'not_started'::text)$$,
  'the carga not passed keeps En curso'
);

select results_eq(
  $$select comment, changed_by from public.shipment_status_history
     where shipment_id = '00000000-0000-0000-0000-0000000006b1' and new_status = 'not_started'$$,
  $$values ('Automático: la carga ya no está en un viaje de hoy'::text,
            '00000000-0000-0000-0000-0000000006a1'::uuid)$$,
  'the backward row carries the actor'
);

-- Reprogramming an En curso carga, as the operations user.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000006a1","role":"authenticated"}', true);

select throws_ok(
  $$select public.change_shipment_status('00000000-0000-0000-0000-0000000006b2', 'reprogrammed')$$,
  '23514',
  'Indicá la nueva fecha.',
  'reprogramming an En curso carga requires the new date'
);

select is(
  public.change_shipment_status('00000000-0000-0000-0000-0000000006b2', 'reprogrammed',
    'no llegó', p_failure_reason => 'camión roto', p_scheduled_date => '2026-12-01'),
  'in_progress',
  'reprogramming returns the status it left'
);

select results_eq(
  $$select status, trip_id, scheduled_date, failure_reason from public.shipments
     where id = '00000000-0000-0000-0000-0000000006b2'$$,
  $$values ('not_started'::text, null::uuid, '2026-12-01'::date, 'camión roto'::text)$$,
  'it goes back to No iniciada, off its trip, with the new date and reason'
);

select results_eq(
  $$select old_status, new_status, comment from public.shipment_status_history
     where shipment_id = '00000000-0000-0000-0000-0000000006b2'
       and changed_by = '00000000-0000-0000-0000-0000000006a1'
     order by changed_at desc$$,
  $$values ('reprogrammed'::text, 'not_started'::text, 'Vuelve a No iniciada y sale del viaje'::text),
           ('in_progress'::text, 'reprogrammed'::text, 'no llegó'::text)$$,
  'two history rows, newest last step first'
);

select throws_ok(
  $$select public.sync_shipment_trip_status()$$,
  '42501',
  null,
  'authenticated cannot run the sync'
);

select * from finish();
rollback;
