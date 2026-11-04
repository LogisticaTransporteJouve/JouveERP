-- ai_fleet_margin returns the freight still to invoice apart from the
-- revenue (20261104160201): per trip, vehicle, driver and client, and over
-- all groups. A cancelled shipment is not pending. Revenue and net are
-- unchanged. 2032 has no seed data. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select plan(6);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.vehicles (id, patente, vehicle_type) values
  ('00000000-0000-0000-0000-0000001602e1', 'FM160AA', 'camion');
-- The freight invoice is internal, so is its client (guard_document_side).
insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000001602d1', false, null, 'Cliente fletes pendientes', null);
insert into public.invoices
  (id, channel_id, client_id, kind, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_total, moneda, cotizacion, status, idempotency_key)
values
  ('00000000-0000-0000-0000-0000001602a1', 'jouve_internal', '00000000-0000-0000-0000-0000001602d1',
   'factura', 1, 9161, '2032-03-10', 2, 80, '30777777778', 300, 300, 'PES', 1, 'emitted', 'fm-unv-flete');

insert into public.trips (id, trip_date, vehicle_id, origin, destination, revenue, cost) values
  ('00000000-0000-0000-0000-0000001602f1', '2032-03-05', '00000000-0000-0000-0000-0000001602e1',
   'Tigre', 'Rosario', 1000, 100),
  ('00000000-0000-0000-0000-0000001602f2', '2032-03-06', '00000000-0000-0000-0000-0000001602e1',
   'Rosario', 'Tigre', 800, 50);

insert into public.shipments (trip_id, client_id, freight_amount, status, invoice_id) values
  ('00000000-0000-0000-0000-0000001602f1', '00000000-0000-0000-0000-0000001602d1', 300, 'delivered',
   '00000000-0000-0000-0000-0000001602a1'),
  ('00000000-0000-0000-0000-0000001602f1', '00000000-0000-0000-0000-0000001602d1', 200, 'delivered', null),
  ('00000000-0000-0000-0000-0000001602f1', '00000000-0000-0000-0000-0000001602d1', 500, 'cancelled', null);

create temporary table by_trip as
  select * from public.ai_fleet_margin('2032-03-01', '2032-03-31', 'trip', 50);
create temporary table by_vehicle as
  select * from public.ai_fleet_margin('2032-03-01', '2032-03-31', 'vehicle', 50);
create temporary table by_client as
  select * from public.ai_fleet_margin('2032-03-01', '2032-03-31', 'client', 50);
create temporary table by_driver as
  select * from public.ai_fleet_margin('2032-03-01', '2032-03-31', 'driver', 50);

select results_eq(
  $$select group_key, revenue, net, uninvoiced_freight from by_trip order by group_key$$,
  $$values ('00000000-0000-0000-0000-0000001602f1'::text, 300.00::numeric, 200.00::numeric, 200.00::numeric),
           ('00000000-0000-0000-0000-0000001602f2'::text, 800.00::numeric, 750.00::numeric, 0.00::numeric)$$,
  'by trip: the uninvoiced freight comes apart and the revenue and net are unchanged'
);

select is(
  (select uninvoiced_freight from by_vehicle where group_key = '00000000-0000-0000-0000-0000001602e1'),
  200.00::numeric,
  'by vehicle: the sum of its trips'' uninvoiced freight'
);

select is(
  (select uninvoiced_freight from by_client where group_key = '00000000-0000-0000-0000-0000001602d1'),
  200.00::numeric,
  'by client: its shipments without invoice, the cancelled one left out'
);

select is(
  (select uninvoiced_freight from by_driver where group_key = 'none'),
  200.00::numeric,
  'by driver: the sum of the trips'' uninvoiced freight'
);

select is(
  (select max(total_uninvoiced_freight) from by_trip),
  200.00::numeric,
  'the total covers every group'
);

select is(
  (select total_uninvoiced_freight
     from public.ai_fleet_margin('2032-03-01', '2032-03-31', 'trip', 1) limit 1),
  200.00::numeric,
  'the total does not depend on the page limit'
);

select * from finish();
rollback;
