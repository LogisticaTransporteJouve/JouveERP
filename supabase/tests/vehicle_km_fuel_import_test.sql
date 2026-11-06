-- Km mensual y combustible (20261103020000): no monthly km reminder task since
-- 20261106191306 (an old one closes on the next sync), the km readings' uniqueness and
-- RLS by role, the km task's fleet ceiling, vehicles.fuel_card, and a fuel
-- load's ticket as a file attachment listed in the files hub. One
-- transaction, rolled back.

begin;

select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ca01', 'ops@km.test'),
  ('00000000-0000-0000-0000-00000000ca02', 'finance@km.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-00000000ca01', 'operations'),
  ('00000000-0000-0000-0000-00000000ca02', 'finance');

create temporary table t_day as
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date as today;
create temporary table t_period as
  select to_char((select today from t_day), 'YYYY-MM') as period,
         md5('vehicle_km:' || to_char((select today from t_day), 'YYYY-MM'))::uuid as source_id;

-- 1. No km reminder any more ----------------------------------------------------------
-- Since 20261106191306 (km from Strix) nobody types km: the sync opens no
-- monthly «Cargar km» task and closes one an older version left open.

insert into public.vehicles (id, patente, vehicle_type) values
  ('00000000-0000-0000-0000-00000000cb01', 'KM001AA', 'camion'),
  ('00000000-0000-0000-0000-00000000cb02', 'KM002AA', 'acoplado');

create temporary table t_sync1 as
  select * from public.sync_automatic_tasks((select today from t_day));

select is(
  (select count(*)::int from t_sync1 s
    join public.tasks t on t.id = s.task_id
   where t.kind = 'vehicle_km'
     and s.change = 'created'),
  0,
  'a truck without this month''s reading opens no km task'
);

-- The task an older version opened for this month.
insert into public.tasks (title, due_date, origin, kind, source_table, source_id)
values ('Cargar km', make_date(extract(year from (select today from t_day))::int,
                               extract(month from (select today from t_day))::int, 5),
        'automatic', 'vehicle_km', 'vehicle_km_readings',
        (select source_id from t_period));

create temporary table t_sync2 as
  select * from public.sync_automatic_tasks((select today from t_day));

select results_eq(
  $$select s.change from t_sync2 s
     where s.task_id = (select id from public.tasks
                         where source_id = (select source_id from t_period))$$,
  $$values ('closed'::text)$$,
  'the next sync reports the old km task closed'
);

select results_eq(
  $$select status, auto_closed from public.tasks
     where source_id = (select source_id from t_period)$$,
  $$values ('done'::text, true)$$,
  'the old km task is closed by the sync'
);

create temporary table t_sync3 as
  select * from public.sync_automatic_tasks((select today from t_day));

select is(
  (select count(*)::int from t_sync3
    where task_id = (select id from public.tasks
                      where source_id = (select source_id from t_period))),
  0,
  'a second run leaves the closed km task alone'
);

-- A new truck without a reading does not reopen it.
insert into public.vehicles (id, patente, vehicle_type) values
  ('00000000-0000-0000-0000-00000000cb03', 'KM003AA', 'utilitario');

create temporary table t_sync4 as
  select * from public.sync_automatic_tasks((select today from t_day));

select is(
  (select status from public.tasks where source_id = (select source_id from t_period)),
  'done',
  'a vehicle added without a reading does not reopen the km task'
);

-- The readings section below loads one for the truck.
insert into public.vehicle_km_readings (vehicle_id, period, km, read_on, loaded_by) values
  ('00000000-0000-0000-0000-00000000cb01', (select period from t_period), 120500,
   (select today from t_day), '00000000-0000-0000-0000-00000000ca01');

-- 2. Readings ------------------------------------------------------------------------

select throws_ok(
  $$insert into public.vehicle_km_readings (vehicle_id, period, km, read_on)
    values ('00000000-0000-0000-0000-00000000cb01', (select period from t_period), 1,
            (select today from t_day))$$,
  '23505',
  null,
  'one reading per vehicle and month'
);

select throws_ok(
  $$insert into public.vehicle_km_readings (vehicle_id, period, km, read_on)
    values ('00000000-0000-0000-0000-00000000cb02', '2026-13', 1, (select today from t_day))$$,
  '23514',
  null,
  'the period is a YYYY-MM month'
);

-- 3. Fuel card --------------------------------------------------------------------------

select throws_ok(
  $$update public.vehicles set fuel_card = '7069-12'
     where id = '00000000-0000-0000-0000-00000000cb01'$$,
  '23514',
  null,
  'a fuel card is stored normalized (digits and uppercase letters)'
);

update public.vehicles set fuel_card = '706912345678'
 where id = '00000000-0000-0000-0000-00000000cb01';

select throws_ok(
  $$update public.vehicles set fuel_card = '706912345678'
     where id = '00000000-0000-0000-0000-00000000cb02'$$,
  '23505',
  null,
  'a fuel card belongs to one vehicle'
);

-- 4. Fuel ticket attachments --------------------------------------------------------------

insert into public.fuel_loads (id, vehicle_id, load_date, liters, amount) values
  ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-00000000cb01',
   (select today from t_day), 300, 450000);

insert into public.files
  (id, uploaded_by, original_filename, mime_type, file_size, bucket, bucket_path, source)
values
  ('00000000-0000-0000-0000-00000000cd01', '00000000-0000-0000-0000-00000000ca01',
   'ticket.jpg', 'image/jpeg', 10, 'files', 'km-test/ticket.jpg', 'manual_upload');

insert into public.file_attachments (file_id, fuel_load_id, kind, created_by) values
  ('00000000-0000-0000-0000-00000000cd01', '00000000-0000-0000-0000-00000000cc01',
   'remito', '00000000-0000-0000-0000-00000000ca01');

select results_eq(
  $$select entity_type, entity_id from public.v_files_hub
     where file_id = '00000000-0000-0000-0000-00000000cd01'$$,
  $$values ('fuel_load'::text, '00000000-0000-0000-0000-00000000cc01'::uuid)$$,
  'the files hub lists a fuel ticket under its load'
);

select throws_ok(
  $$insert into public.file_attachments (file_id, fuel_load_id, transaction_id, kind)
    values ('00000000-0000-0000-0000-00000000cd01', '00000000-0000-0000-0000-00000000cc01',
            gen_random_uuid(), 'remito')$$,
  '23514',
  null,
  'an attachment still points at exactly one entity'
);

-- 5. RLS -----------------------------------------------------------------------------------

set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000ca01","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.vehicle_km_readings
    where vehicle_id = '00000000-0000-0000-0000-00000000cb01'),
  1,
  'operations reads the km readings'
);

-- Temporary tables are not readable as authenticated: the id is spelled out.
select is(
  (select count(*)::int from public.tasks
    where source_id = md5('vehicle_km:' || to_char(
      (now() at time zone 'America/Argentina/Buenos_Aires')::date, 'YYYY-MM'))::uuid),
  1,
  'operations sees the km task'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000ca02","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.vehicle_km_readings),
  0,
  'finance reads no km reading'
);

select is(
  (select count(*)::int from public.tasks where source_table = 'vehicle_km_readings'),
  0,
  'finance does not see the km task (fleet ceiling)'
);

select throws_ok(
  $$insert into public.vehicle_km_readings (vehicle_id, period, km, read_on)
    values ('00000000-0000-0000-0000-00000000cb02', '2020-01', 1, current_date)$$,
  '42501',
  null,
  'finance cannot load a km reading'
);

reset role;

select * from finish(true);

rollback;
