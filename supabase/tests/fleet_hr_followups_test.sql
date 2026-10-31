-- Fleet and HR follow-ups (20261031201921): a fleet document's file is
-- readable only by the fleet roles, shows in the files hub and survives the
-- orphan sweep; a trip's revenue is the freight of its invoiced shipments
-- (manual revenue only without shipments), in v_trip_revenue and
-- ai_fleet_margin; grant_vacation_balances follows LCT art. 151-153 over
-- working days and unjustified absences. One transaction, rolled back.

begin;

select plan(20);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000fd01', 'ops@fleet-hr.test'),
  ('00000000-0000-0000-0000-00000000fd02', 'finance@fleet-hr.test'),
  ('00000000-0000-0000-0000-00000000fd03', 'admin@fleet-hr.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-00000000fd01', 'operations'),
  ('00000000-0000-0000-0000-00000000fd02', 'finance'),
  ('00000000-0000-0000-0000-00000000fd03', 'admin');

-- 1. Fleet document files ----------------------------------------------------

insert into public.vehicles (id, patente, vehicle_type) values
  ('00000000-0000-0000-0000-00000000fe01', 'FH001AA', 'camion');

insert into public.files
  (id, uploaded_by, original_filename, mime_type, file_size, bucket, bucket_path, source, created_at)
values
  ('00000000-0000-0000-0000-00000000ff01', '00000000-0000-0000-0000-00000000fd01',
   'vtv.pdf', 'application/pdf', 10, 'files', 'fleet-hr/vtv.pdf', 'manual_upload', now() - interval '2 days'),
  ('00000000-0000-0000-0000-00000000ff02', '00000000-0000-0000-0000-00000000fd01',
   'suelto.pdf', 'application/pdf', 10, 'files', 'fleet-hr/suelto.pdf', 'manual_upload', now() - interval '2 days');

insert into public.fleet_documents (id, vehicle_id, kind, expires_at, attachment_file_id) values
  ('00000000-0000-0000-0000-00000000fc01', '00000000-0000-0000-0000-00000000fe01', 'vtv',
   current_date + 200, '00000000-0000-0000-0000-00000000ff01');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000fd01","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.files where id = '00000000-0000-0000-0000-00000000ff01'),
  1,
  'operations reads the file of a fleet document'
);
select is(
  (select entity_type from public.v_files_hub where file_id = '00000000-0000-0000-0000-00000000ff01'),
  'fleet_document',
  'the files hub lists the fleet document file'
);
select lives_ok(
  $$update public.fleet_documents
       set attachment_file_id = '00000000-0000-0000-0000-00000000ff01'
     where id = '00000000-0000-0000-0000-00000000fc01'$$,
  'operations links a file to a fleet document'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000fd02","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.files where id = '00000000-0000-0000-0000-00000000ff01'),
  0,
  'finance (files:read without fleet_documents:read) cannot read it'
);
select is(
  (select count(*)::int from public.files where id = '00000000-0000-0000-0000-00000000ff02'),
  1,
  'finance still reads an unrelated file'
);

reset role;

select ok(
  not exists (select 1 from public.find_orphan_files('1 hour')
               where id = '00000000-0000-0000-0000-00000000ff01'),
  'the orphan sweep keeps a file a fleet document points at'
);
select ok(
  exists (select 1 from public.find_orphan_files('1 hour')
           where id = '00000000-0000-0000-0000-00000000ff02'),
  'the orphan sweep still finds an unlinked file'
);

-- 2. Trip revenue from invoiced shipments --------------------------------------

insert into public.clients (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000fb01', '30777777778', 'Cliente Fletes', 'responsable_inscripto');
insert into public.invoices
  (id, channel_id, client_id, kind, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_total, moneda, cotizacion, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000000fa01', 'jouve_internal', '00000000-0000-0000-0000-00000000fb01',
   'factura', 1, 9101, '2031-03-10', 2, 80, '30777777778', 300, 300, 'PES', 1, 'emitted', 'fh-flete');

insert into public.trips (id, trip_date, vehicle_id, origin, destination, revenue, cost) values
  ('00000000-0000-0000-0000-00000000f901', '2031-03-05', '00000000-0000-0000-0000-00000000fe01',
   'Tigre', 'Rosario', 1000, 100),
  ('00000000-0000-0000-0000-00000000f902', '2031-03-06', '00000000-0000-0000-0000-00000000fe01',
   'Rosario', 'Tigre', 800, 50);

insert into public.shipments (trip_id, client_id, freight_amount, status, invoice_id) values
  ('00000000-0000-0000-0000-00000000f901', '00000000-0000-0000-0000-00000000fb01', 300, 'delivered',
   '00000000-0000-0000-0000-00000000fa01'),
  ('00000000-0000-0000-0000-00000000f901', '00000000-0000-0000-0000-00000000fb01', 200, 'delivered', null),
  ('00000000-0000-0000-0000-00000000f901', '00000000-0000-0000-0000-00000000fb01', 500, 'cancelled', null);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000fd01","role":"authenticated"}', true);

select is(
  (select revenue_source || ':' || revenue || ':' || invoiced_revenue || ':' || uninvoiced_freight
     from public.v_trip_revenue where trip_id = '00000000-0000-0000-0000-00000000f901'),
  'invoiced:300.00:300.00:200.00',
  'a trip with shipments earns only the invoiced freight (cancelled ones ignored)'
);
select is(
  (select revenue_source || ':' || revenue
     from public.v_trip_revenue where trip_id = '00000000-0000-0000-0000-00000000f902'),
  'manual:800.00',
  'a trip without shipments keeps its manual revenue'
);
select is(
  (select revenue || ':' || invoiced_revenue || ':' || manual_revenue || ':' || net
     from public.ai_fleet_margin('2031-03-01', '2031-03-31', 'trip', 50)
    where group_key = '00000000-0000-0000-0000-00000000f901'),
  '300.00:300.00:1000.00:200.00',
  'ai_fleet_margin by trip shows invoiced and manual and nets the invoiced'
);
select is(
  (select revenue || ':' || invoiced_revenue || ':' || manual_revenue || ':' || net
     from public.ai_fleet_margin('2031-03-01', '2031-03-31', 'vehicle', 50)
    where group_key = '00000000-0000-0000-0000-00000000fe01'),
  '1100.00:300.00:1800.00:950.00',
  'ai_fleet_margin by vehicle adds invoiced trips and manual-only trips'
);
select is(
  (select revenue || ':' || invoiced_revenue
     from public.ai_fleet_margin('2031-03-01', '2031-03-31', 'client', 50)
    where group_key = '00000000-0000-0000-0000-00000000fb01'),
  '300.00:300.00',
  'ai_fleet_margin by client carries each shipment''s invoiced freight'
);
select is(
  (select total_revenue from public.ai_fleet_margin('2031-03-01', '2031-03-31', 'trip', 1) limit 1),
  1100.00::numeric,
  'the window total uses the same revenue'
);

reset role;

-- 3. Vacations: LCT art. 151-153 (2031 has no seeded holidays: 261 weekdays) --

insert into public.employees (id, legal_name, pay_frequency, hire_date) values
  ('00000000-0000-0000-0000-00000000f801', 'Ingreso julio', 'mensual', '2031-07-02'),
  ('00000000-0000-0000-0000-00000000f802', 'Ingreso septiembre', 'mensual', '2031-09-01'),
  ('00000000-0000-0000-0000-00000000f803', 'Faltador', 'mensual', '2010-01-01'),
  ('00000000-0000-0000-0000-00000000f804', 'Enfermo', 'mensual', '2010-01-01');

-- 140 weekdays from 2031-01-01: unjustified for one, sick for the other.
insert into public.attendance_records (employee_id, date, kind)
select e.id, d.day, e.kind::public.attendance_kind
from (values
  ('00000000-0000-0000-0000-00000000f803'::uuid, 'absent_unjustified'),
  ('00000000-0000-0000-0000-00000000f804'::uuid, 'sick')
) as e(id, kind)
cross join (
  select day from (
    select date '2031-01-01' + i as day
    from generate_series(0, 364) as i
  ) all_days
  where extract(isodow from day) < 6
  order by day
  limit 140
) d;

select is(
  (select year_work_days || ':' || employee_work_days || ':' || effective_work_days
     from public.vacation_work_days('00000000-0000-0000-0000-00000000f803', 2031)),
  '261:261:121',
  'working days exclude weekends and unjustified absences'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000fd03","role":"authenticated"}', true);

create temp table granted on commit drop as
  select * from public.grant_vacation_balances(2031, false);

reset role;

select is(
  (select entitled_days from granted where employee_id = '00000000-0000-0000-0000-00000000f801'),
  14,
  'hired July 2 with 131 of 261 working days reaches half the year: full period'
);
select is(
  (select entitled_days from granted where employee_id = '00000000-0000-0000-0000-00000000f802'),
  4,
  'hired September 1: 88 working days / 20 = 4 days, not calendar days / 20'
);
select is(
  (select entitled_days from granted where employee_id = '00000000-0000-0000-0000-00000000f803'),
  6,
  'below half the year by unjustified absences: 121 effective days / 20 = 6'
);
select is(
  (select entitled_days from granted where employee_id = '00000000-0000-0000-0000-00000000f804'),
  35,
  'sick days count as worked (art. 152): the full 35 days by tenure'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000fd02","role":"authenticated"}', true);
select throws_ok(
  $$select * from public.grant_vacation_balances(2032, false)$$,
  '42501',
  null,
  'finance still cannot grant balances'
);
reset role;
-- has_function_privilege, not a call: on the local image a call without
-- EXECUTE crashes the backend.
select ok(
  not has_function_privilege('authenticated', 'public.vacation_work_days(uuid, integer)', 'execute'),
  'the work-days helper is not callable by authenticated'
);

select * from finish();
rollback;
