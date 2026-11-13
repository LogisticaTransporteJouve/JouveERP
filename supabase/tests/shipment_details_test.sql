-- Carga details (20261112180000): Tipo defaults to carga and only takes the
-- three kinds; the unload day cannot precede the load day; reprogramming the
-- load day shifts an unload day it would pass; the time window is short text.
-- One transaction, rolled back.

begin;

select plan(7);

insert into public.shipments (id, status, scheduled_date, unload_date, origin, destination, time_window, notes) values
  ('00000000-0000-0000-0000-0000006b0001', 'not_started', '2097-05-10', '2097-05-12',
   'Depósito Norte', 'Av. Siempreviva 742', '8 a 12 hs', 'Llamar antes');

select results_eq(
  $$select kind, origin, destination, time_window, notes from public.shipments
     where id = '00000000-0000-0000-0000-0000006b0001'$$,
  $$values ('carga'::text, 'Depósito Norte'::text, 'Av. Siempreviva 742'::text, '8 a 12 hs'::text, 'Llamar antes'::text)$$,
  '1. a carga is a «carga» by default and keeps its addresses, horario and observaciones'
);

select throws_ok(
  $$insert into public.shipments (status, kind) values ('not_started', 'flete')$$,
  '23514', null,
  '2. an unknown tipo is refused'
);

select lives_ok(
  $$insert into public.shipments (status, kind) values ('not_started', 'mudanza'), ('not_started', 'retiro')$$,
  '3. mudanza and retiro are tipos'
);

select throws_ok(
  $$insert into public.shipments (status, scheduled_date, unload_date) values ('not_started', '2097-05-10', '2097-05-09')$$,
  '23514', null,
  '4. the unload day cannot precede the load day'
);

update public.shipments set scheduled_date = '2097-05-20'
 where id = '00000000-0000-0000-0000-0000006b0001';

select is(
  (select unload_date from public.shipments where id = '00000000-0000-0000-0000-0000006b0001'),
  '2097-05-22'::date,
  '5. moving the load day past the unload day shifts it by the same days'
);

update public.shipments set scheduled_date = '2097-05-21', unload_date = '2097-05-21'
 where id = '00000000-0000-0000-0000-0000006b0001';

select is(
  (select unload_date from public.shipments where id = '00000000-0000-0000-0000-0000006b0001'),
  '2097-05-21'::date,
  '6. an update that sets both keeps the unload day it was given'
);

select throws_ok(
  $$update public.shipments set time_window = repeat('x', 61)
     where id = '00000000-0000-0000-0000-0000006b0001'$$,
  '23514', null,
  '7. the horario is short text'
);

select * from finish();

rollback;
