-- Fleet figures that are not final say so (20261104170201): v_trip_revenue
-- and ai_fleet_margin count the cargas still to invoice (a tariff-priced one
-- has no freight yet); by vehicle, the trips without a vehicle are the group
-- 'none', so the totals match those by trip; a service with no cost is
-- counted, in ai_fleet_margin and get_vehicle_margin. 2035 has no seed data.
-- One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select plan(13);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.vehicles (id, patente, vehicle_type) values
  ('00000000-0000-0000-0000-0000001702e1', 'FP170AA', 'camion');
-- The freight invoice is internal, so is its client (guard_document_side).
insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000001702d1', false, null, 'Cliente fletes por tarifa', null);
insert into public.invoices
  (id, channel_id, client_id, kind, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_total, moneda, cotizacion, status, idempotency_key)
values
  ('00000000-0000-0000-0000-0000001702a1', 'jouve_internal', '00000000-0000-0000-0000-0000001702d1',
   'factura', 1, 9171, '2035-03-10', 2, 80, '30777777778', 300, 300, 'PES', 1, 'emitted', 'fp-count-flete');

-- f1 (truck): one carga invoiced for 300 and one priced by tariff, still to
-- invoice (no freight). f2: no vehicle, no cargas, manual revenue 500.
insert into public.trips (id, trip_date, vehicle_id, origin, destination, revenue, cost) values
  ('00000000-0000-0000-0000-0000001702f1', '2035-03-05', '00000000-0000-0000-0000-0000001702e1',
   'Tigre', 'Rosario', null, 100),
  ('00000000-0000-0000-0000-0000001702f2', '2035-03-06', null,
   'Rosario', 'Tigre', 500, 400);

insert into public.shipments (trip_id, client_id, freight_amount, status, invoice_id) values
  ('00000000-0000-0000-0000-0000001702f1', '00000000-0000-0000-0000-0000001702d1', 300, 'delivered',
   '00000000-0000-0000-0000-0000001702a1'),
  ('00000000-0000-0000-0000-0000001702f1', '00000000-0000-0000-0000-0000001702d1', null, 'delivered', null),
  ('00000000-0000-0000-0000-0000001702f1', '00000000-0000-0000-0000-0000001702d1', null, 'cancelled', null);

-- One service with a cost, one without.
insert into public.maintenance_records (vehicle_id, service_date, kind, description, cost) values
  ('00000000-0000-0000-0000-0000001702e1', '2035-03-15', 'service', 'Service con costo', 100),
  ('00000000-0000-0000-0000-0000001702e1', '2035-03-16', 'service', 'Service sin costo', null);

set constraints all immediate;

-- Materialized: volatile reads used several times below.
create temporary table by_trip as
  select * from public.ai_fleet_margin('2035-03-01', '2035-03-31', 'trip', 50);
create temporary table by_vehicle as
  select * from public.ai_fleet_margin('2035-03-01', '2035-03-31', 'vehicle', 50);
create temporary table by_client as
  select * from public.ai_fleet_margin('2035-03-01', '2035-03-31', 'client', 50);
create temporary table vm as
  select * from public.get_vehicle_margin('2035-03-01', '2035-03-31');

select results_eq(
  $$select uninvoiced_freight, uninvoiced_shipments from public.v_trip_revenue
     where trip_id = '00000000-0000-0000-0000-0000001702f1'$$,
  $$values (0.00::numeric(14, 2), 1)$$,
  'the view counts a tariff-priced carga still to invoice, with no freight (the cancelled one left out)'
);

select results_eq(
  $$select uninvoiced_shipments, total_uninvoiced_shipments from by_trip
     where group_key = '00000000-0000-0000-0000-0000001702f1'$$,
  $$values (1, 1)$$,
  'by trip: the carga still to invoice is counted'
);

select is(
  (select uninvoiced_shipments from by_client where group_key = '00000000-0000-0000-0000-0000001702d1'),
  1,
  'by client: its carga still to invoice is counted'
);

select results_eq(
  $$select label, trips, revenue, trip_cost, fuel_cost, net from by_vehicle where group_key = 'none'$$,
  $$values ('Sin vehículo'::text, 1, 500.00::numeric, 400.00::numeric, 0.00::numeric, 100.00::numeric)$$,
  'by vehicle: the trips without a vehicle are the group none'
);

select is(
  (select max(total_revenue) from by_vehicle),
  (select max(total_revenue) from by_trip),
  'the revenue total is the same by vehicle as by trip'
);

select is(
  (select max(total_net) from by_vehicle),
  (select max(total_net) from by_trip) - 100,
  'the net total by vehicle is the one by trip minus the maintenance'
);

select results_eq(
  $$select maintenance_cost, maintenance_without_cost, uninvoiced_shipments from by_vehicle
     where group_key = '00000000-0000-0000-0000-0000001702e1'$$,
  $$values (100.00::numeric, 1, 1)$$,
  'by vehicle: the service without a cost is counted apart, not as $0'
);

select results_eq(
  $$select distinct total_maintenance_without_cost, total_uninvoiced_shipments from by_vehicle$$,
  $$values (1, 1)$$,
  'and in the window totals'
);

select results_eq(
  $$select maintenance_cost, maintenance_without_cost from vm
     where row_kind = 'vehicle' and vehicle_id = '00000000-0000-0000-0000-0000001702e1'$$,
  $$values (100.00::numeric, 1)$$,
  'get_vehicle_margin counts the truck''s services without a cost'
);

select results_eq(
  $$select row_kind, trips, revenue from vm where vehicle_id is null and row_kind = 'no_vehicle'$$,
  $$values ('no_vehicle'::text, 1, 500.00::numeric)$$,
  'get_vehicle_margin still keeps the trips without a vehicle apart, once'
);

select is(
  (select count(*)::int from vm where row_kind = 'vehicle'),
  1,
  'the none group is not a truck there'
);

select ok(
  has_function_privilege('authenticated', 'public.ai_fleet_margin(date, date, text, integer, boolean)', 'execute')
    and not has_function_privilege('anon', 'public.ai_fleet_margin(date, date, text, integer, boolean)', 'execute')
    and not has_function_privilege('authenticated', 'public.get_vehicle_margin(date, date)', 'execute')
    and has_function_privilege('service_role', 'public.get_vehicle_margin(date, date)', 'execute'),
  'the functions keep their grants'
);

select ok(
  (select 'security_invoker=on' = any (c.reloptions)
     from pg_class c where c.oid = 'public.v_trip_revenue'::regclass),
  'the view is still security invoker'
);

select * from finish();
rollback;
