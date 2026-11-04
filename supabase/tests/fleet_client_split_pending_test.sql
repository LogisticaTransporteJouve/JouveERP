-- By client, ai_fleet_margin says a cost split is not final
-- (20261104194201): a client sharing a trip with another client's carga
-- still to invoice and without freight (priced by tariff) counts that carga
-- in its uninvoiced_shipments; one with a freight already does not change
-- the split and is not counted. The window total still counts each carga
-- once. 2037 has no seed data. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select plan(5);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- The freight invoice is internal, so is its client (guard_document_side).
insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000001942d1', false, null, 'Cliente A reparto', null),
  ('00000000-0000-0000-0000-0000001942d2', false, null, 'Cliente B reparto', null);
insert into public.invoices
  (id, channel_id, client_id, kind, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_total, moneda, cotizacion, status, idempotency_key)
values
  ('00000000-0000-0000-0000-0000001942a1', 'jouve_internal', '00000000-0000-0000-0000-0000001942d1',
   'factura', 1, 9421, '2037-03-10', 2, 80, '30777777778', 1100, 1100, 'PES', 1, 'emitted', 'fcs-flete-a');

-- t1: A's carga invoiced for 1000; B's two cargas priced by tariff, still to
-- invoice (no freight). t2: A's carga invoiced for 100; B's carga with a
-- freight of 100, still to invoice.
insert into public.trips (id, trip_date, vehicle_id, origin, destination, revenue, cost) values
  ('00000000-0000-0000-0000-0000001942f1', '2037-03-05', null, 'Tigre', 'Rosario', null, 1000),
  ('00000000-0000-0000-0000-0000001942f2', '2037-03-06', null, 'Rosario', 'Tigre', null, 200);

insert into public.shipments (trip_id, client_id, freight_amount, status, invoice_id) values
  ('00000000-0000-0000-0000-0000001942f1', '00000000-0000-0000-0000-0000001942d1', 1000, 'delivered',
   '00000000-0000-0000-0000-0000001942a1'),
  ('00000000-0000-0000-0000-0000001942f1', '00000000-0000-0000-0000-0000001942d2', null, 'delivered', null),
  ('00000000-0000-0000-0000-0000001942f1', '00000000-0000-0000-0000-0000001942d2', null, 'delivered', null),
  ('00000000-0000-0000-0000-0000001942f2', '00000000-0000-0000-0000-0000001942d1', 100, 'delivered',
   '00000000-0000-0000-0000-0000001942a1'),
  ('00000000-0000-0000-0000-0000001942f2', '00000000-0000-0000-0000-0000001942d2', 100, 'delivered', null);

set constraints all immediate;

-- Materialized: volatile reads used several times below.
create temporary table by_client as
  select * from public.ai_fleet_margin('2037-03-01', '2037-03-31', 'client', 50);
create temporary table by_trip as
  select * from public.ai_fleet_margin('2037-03-01', '2037-03-31', 'trip', 50);

select results_eq(
  $$select trip_cost, uninvoiced_freight, uninvoiced_shipments from by_client
     where group_key = '00000000-0000-0000-0000-0000001942d1'$$,
  $$values (1100.00::numeric, 0.00::numeric, 2)$$,
  'A keeps the split by freight and counts B''s two unpriced cargas on its trip, not B''s priced one'
);

select results_eq(
  $$select trip_cost, uninvoiced_freight, uninvoiced_shipments from by_client
     where group_key = '00000000-0000-0000-0000-0000001942d2'$$,
  $$values (100.00::numeric, 100.00::numeric, 3)$$,
  'B counts its own three cargas still to invoice, once each'
);

select is(
  (select max(total_uninvoiced_shipments) from by_client),
  3,
  'the window total by client counts each carga once'
);

select is(
  (select max(total_uninvoiced_shipments) from by_client),
  (select max(total_uninvoiced_shipments) from by_trip),
  'the same total as by trip'
);

select ok(
  has_function_privilege('authenticated', 'public.ai_fleet_margin(date, date, text, integer, boolean)', 'execute')
    and has_function_privilege('service_role', 'public.ai_fleet_margin(date, date, text, integer, boolean)', 'execute')
    and not has_function_privilege('anon', 'public.ai_fleet_margin(date, date, text, integer, boolean)', 'execute'),
  'the function keeps its grants'
);

select * from finish();
rollback;
