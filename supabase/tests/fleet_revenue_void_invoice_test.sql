-- Audit w13 S3 F1 / S1 F1 / S6 F4 (20261105090001): a carga whose invoice no
-- longer bills it (a fiscal factura its emitted NCs credit in full) is not
-- invoiced revenue: v_trip_revenue, ai_fleet_margin (by trip, vehicle and
-- client) and ai_shipments_summary count it as still to invoice, for owner,
-- for operations (who cannot read invoices) and for the service role. A
-- partial NC keeps it billed. 2038 has no seed data. One transaction, rolled
-- back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000013b0f1', 'ops@fleet-void-w13.test'),
  ('00000000-0000-0000-0000-00000013b0f2', 'owner@fleet-void-w13.test'),
  ('00000000-0000-0000-0000-00000013b0f3', 'warehouse@fleet-void-w13.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-00000013b0f1', 'operations'),
  ('00000000-0000-0000-0000-00000013b0f2', 'owner'),
  ('00000000-0000-0000-0000-00000013b0f3', 'warehouse');

insert into public.vehicles (id, patente, vehicle_type) values
  ('00000000-0000-0000-0000-00000013b0e1', 'FV130AA', 'camion');

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000013b0c1', true, '30777777778', 'Cliente flota void w13', 'responsable_inscripto');

-- f1 is credited in full below, f2 in part.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000013b0a1', 'jouve_fiscal', '00000000-0000-0000-0000-00000013b0c1',
   'factura', 'A', 3, 98401, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 1, 1,
   'emitted', 'fleet-void-w13-f1'),
  ('00000000-0000-0000-0000-00000013b0a2', 'jouve_fiscal', '00000000-0000-0000-0000-00000013b0c1',
   'factura', 'A', 3, 98402, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 1, 1,
   'emitted', 'fleet-void-w13-f2');

-- One trip of the truck: k1 billed on f1 (flete 100), k2 billed on f2 (flete
-- 100), linked while their factura was live.
insert into public.trips (id, trip_date, vehicle_id, origin, destination, revenue, cost) values
  ('00000000-0000-0000-0000-00000013b0b1', '2038-03-05', '00000000-0000-0000-0000-00000013b0e1',
   'Tigre', 'Rosario', null, 50);
insert into public.shipments
  (id, trip_id, client_id, scheduled_date, freight_amount, status, invoice_id)
values
  ('00000000-0000-0000-0000-00000013b0d1', '00000000-0000-0000-0000-00000013b0b1',
   '00000000-0000-0000-0000-00000013b0c1', '2038-03-05', 100, 'delivered',
   '00000000-0000-0000-0000-00000013b0a1'),
  ('00000000-0000-0000-0000-00000013b0d2', '00000000-0000-0000-0000-00000013b0b1',
   '00000000-0000-0000-0000-00000013b0c1', '2038-03-05', 100, 'delivered',
   '00000000-0000-0000-0000-00000013b0a2');

-- Before any NC both cargas are invoiced.
select is(
  (select invoiced_revenue || ':' || uninvoiced_shipments
     from public.v_trip_revenue where trip_id = '00000000-0000-0000-0000-00000013b0b1'),
  '200.00:0',
  'both cargas count as invoiced while their facturas bill them'
);

-- The NCs: f1 credited in full, f2 for 50 of its 121.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000013b0a3', 'jouve_fiscal', '00000000-0000-0000-0000-00000013b0c1',
   'nc', 'A', 3, 98403, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 3, 1,
   'emitted', 'fleet-void-w13-nc1', '00000000-0000-0000-0000-00000013b0a1'),
  ('00000000-0000-0000-0000-00000013b0a4', 'jouve_fiscal', '00000000-0000-0000-0000-00000013b0c1',
   'nc', 'A', 3, 98404, current_date, 2, 80, '30777777778', 50, 0, 50, 'PES', 1, 3, 1,
   'emitted', 'fleet-void-w13-nc2', '00000000-0000-0000-0000-00000013b0a2');

-- Service role (insights, get_vehicle_margin) ---------------------------------------

select is(
  (select revenue || ':' || invoiced_revenue || ':' || uninvoiced_freight || ':' || uninvoiced_shipments
     from public.v_trip_revenue where trip_id = '00000000-0000-0000-0000-00000013b0b1'),
  '100.00:100.00:100.00:1',
  'the carga credited in full leaves the revenue and counts as still to invoice; the partial NC keeps the other'
);

create temporary table by_trip as
  select * from public.ai_fleet_margin('2038-03-01', '2038-03-31', 'trip', 50);
create temporary table by_vehicle as
  select * from public.ai_fleet_margin('2038-03-01', '2038-03-31', 'vehicle', 50);
create temporary table by_client as
  select * from public.ai_fleet_margin('2038-03-01', '2038-03-31', 'client', 50);

select results_eq(
  $$select invoiced_revenue, uninvoiced_freight, uninvoiced_shipments from by_trip
     where group_key = '00000000-0000-0000-0000-00000013b0b1'$$,
  $$values (100.00::numeric, 100.00::numeric, 1)$$,
  'ai_fleet_margin by trip: the credited carga is pending'
);

select results_eq(
  $$select revenue, net, uninvoiced_shipments from by_vehicle
     where group_key = '00000000-0000-0000-0000-00000013b0e1'$$,
  $$values (100.00::numeric, 50.00::numeric, 1)$$,
  'ai_fleet_margin by vehicle: the truck''s net leaves out the credited flete and is not final'
);

select results_eq(
  $$select revenue, invoiced_revenue, uninvoiced_freight, uninvoiced_shipments from by_client
     where group_key = '00000000-0000-0000-0000-00000013b0c1'$$,
  $$values (100.00::numeric, 100.00::numeric, 100.00::numeric, 1)$$,
  'ai_fleet_margin by client: the split counts the credited carga as still to invoice'
);

select results_eq(
  $$select shipments, invoiced
      from public.ai_shipments_summary('2038-03-01', '2038-03-31')
     where client_id = '00000000-0000-0000-0000-00000013b0c1'$$,
  $$values (2, 1)$$,
  'the cargas summary counts only the carga its factura still bills'
);

-- Owner ------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000013b0f2","role":"authenticated"}', true);

select is(
  (select invoiced_revenue || ':' || uninvoiced_shipments
     from public.v_trip_revenue where trip_id = '00000000-0000-0000-0000-00000013b0b1'),
  '100.00:1',
  'owner reads the same figures'
);

-- Operations, who reads cargas and trips but not invoices --------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000013b0f1","role":"authenticated"}', true);

select is_empty(
  $$select 1 from public.invoices where id = '00000000-0000-0000-0000-00000013b0a1'$$,
  'operations does not read the factura'
);

select is(
  (select invoiced_revenue || ':' || uninvoiced_shipments
     from public.v_trip_revenue where trip_id = '00000000-0000-0000-0000-00000013b0b1'),
  '100.00:1',
  'operations reads the same figures as owner'
);

select is(
  public.shipment_invoice_is_void('00000000-0000-0000-0000-00000013b0d1'),
  true,
  'operations gets the carga''s answer, only yes or no'
);

-- A role that does not read cargas gets no answer.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000013b0f3","role":"authenticated"}', true);

select is(
  public.shipment_invoice_is_void('00000000-0000-0000-0000-00000013b0d1'),
  null::boolean,
  'a role that does not read cargas gets null'
);

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select ok(
  (select p.prosecdef from pg_proc p
    where p.oid = 'public.shipment_invoice_is_void(uuid)'::regprocedure)
  and has_function_privilege('authenticated', 'public.shipment_invoice_is_void(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.shipment_invoice_is_void(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.shipment_invoice_is_void(uuid)', 'execute'),
  'the helper is security definer, for authenticated and the service role only'
);

select * from finish();

rollback;
