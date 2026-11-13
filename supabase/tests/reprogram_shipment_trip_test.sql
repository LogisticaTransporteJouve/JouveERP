-- reprogram_shipment (20261112190000): reprogramming takes the carga off its
-- trip and, when asked, puts it on a live trip of the new date in the same
-- transaction; a refused trip rolls the reprogramming back. One
-- transaction, rolled back.

begin;

select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000006c0a01', 'ops@reprogram-trip.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000006c0a01', 'operations');

insert into public.trips (id, trip_date, status) values
  ('00000000-0000-0000-0000-0000006c0b01', '2096-03-01', 'planned'),
  ('00000000-0000-0000-0000-0000006c0b02', '2096-03-10', 'planned'),
  ('00000000-0000-0000-0000-0000006c0b03', '2096-03-10', 'cancelled');
insert into public.shipments (id, status, scheduled_date, trip_id) values
  ('00000000-0000-0000-0000-0000006c0c01', 'not_started', '2096-03-01', '00000000-0000-0000-0000-0000006c0b01'),
  ('00000000-0000-0000-0000-0000006c0c02', 'not_started', '2096-03-01', '00000000-0000-0000-0000-0000006c0b01');

select ok(
  has_function_privilege('authenticated', 'public.reprogram_shipment(uuid, date, text, text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.reprogram_shipment(uuid, date, text, text, uuid)', 'execute'),
  'authenticated runs reprogram_shipment; anon does not'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000006c0a01","role":"authenticated"}', true);

select is(
  public.reprogram_shipment('00000000-0000-0000-0000-0000006c0c01', '2096-03-10', 'lluvia', 'ok',
    '00000000-0000-0000-0000-0000006c0b02'),
  'not_started',
  'it returns the status it left'
);

select results_eq(
  $$select status, scheduled_date, trip_id, failure_reason from public.shipments
     where id = '00000000-0000-0000-0000-0000006c0c01'$$,
  $$values ('reprogrammed'::text, '2096-03-10'::date,
            '00000000-0000-0000-0000-0000006c0b02'::uuid, 'lluvia'::text)$$,
  'the carga is reprogrammed onto the trip of its new date'
);

select is(
  (select count(*)::int from public.shipment_status_history
    where shipment_id = '00000000-0000-0000-0000-0000006c0c01' and new_status = 'reprogrammed'),
  1,
  'the history keeps the reprogramming'
);

select lives_ok(
  $$select public.reprogram_shipment('00000000-0000-0000-0000-0000006c0c02', '2096-03-05')$$,
  'without a trip it still reprograms'
);

select is(
  (select trip_id from public.shipments where id = '00000000-0000-0000-0000-0000006c0c02'),
  null::uuid,
  'and the carga leaves its current trip'
);

select throws_ok(
  $$select public.reprogram_shipment('00000000-0000-0000-0000-0000006c0c02', '2096-03-10', null, null,
      '00000000-0000-0000-0000-0000006c0b03')$$,
  '23514', null,
  'a cancelled trip is refused'
);

select throws_ok(
  $$select public.reprogram_shipment('00000000-0000-0000-0000-0000006c0c02', '2096-03-11', null, null,
      '00000000-0000-0000-0000-0000006c0b02')$$,
  '23514', null,
  'a trip of another date is refused, and nothing changes'
);

select * from finish();
rollback;
