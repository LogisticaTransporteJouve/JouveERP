-- Audit w14 S3 F1 / F2 (20261105100001): a carga counts in fleet revenue at
-- the share of its flete its invoice still bills after its emitted NCs and
-- NDs, (total − NC + ND) / total. A partial NC lowers it, an ND raises it, a
-- full NC leaves it at 0 and still to invoice (the void rule). An interest ND
-- and an internal NC do not count. v_trip_revenue, ai_fleet_margin (by
-- vehicle and client) and ai_shipments_summary agree, for the service role
-- and for operations (who cannot read invoices). ai_shipments_summary also
-- counts the cargas with no flete. 2039 has no seed data. One transaction,
-- rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000014b3f1', 'ops@fleet-share-w14.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-00000014b3f1', 'operations');

insert into public.vehicles (id, patente, vehicle_type) values
  ('00000000-0000-0000-0000-00000014b3e1', 'FS140AA', 'camion');

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000014b3c1', true, '30777777778', 'Cliente flota parte w14', 'responsable_inscripto'),
  ('00000000-0000-0000-0000-00000014b3c2', false, null, 'Cliente flota interno w14', null);

-- f1..f4: fiscal facturas of 121 (100 + IVA). i5: an internal remito of 100.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, fch_vto_pago, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000014b3a1', 'jouve_fiscal', '00000000-0000-0000-0000-00000014b3c1',
   'factura', 'A', 3, 98141, current_date, current_date + 30, 2, 80, '30777777778', 100, 21, 121,
   'PES', 1, 1, 1, 'emitted', 'fleet-share-w14-f1'),
  ('00000000-0000-0000-0000-00000014b3a2', 'jouve_fiscal', '00000000-0000-0000-0000-00000014b3c1',
   'factura', 'A', 3, 98142, current_date, current_date + 30, 2, 80, '30777777778', 100, 21, 121,
   'PES', 1, 1, 1, 'emitted', 'fleet-share-w14-f2'),
  ('00000000-0000-0000-0000-00000014b3a3', 'jouve_fiscal', '00000000-0000-0000-0000-00000014b3c1',
   'factura', 'A', 3, 98143, current_date, current_date + 30, 2, 80, '30777777778', 100, 21, 121,
   'PES', 1, 1, 1, 'emitted', 'fleet-share-w14-f3'),
  ('00000000-0000-0000-0000-00000014b3a4', 'jouve_fiscal', '00000000-0000-0000-0000-00000014b3c1',
   'factura', 'A', 3, 98144, current_date, current_date + 30, 2, 80, '30777777778', 100, 21, 121,
   'PES', 1, 1, 1, 'emitted', 'fleet-share-w14-f4');
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000014b3a5', 'jouve_internal', '00000000-0000-0000-0000-00000014b3c2',
   'factura', null, 9001, 98145, current_date, 2, 99, '0', 100, 0, 100, 'emitted',
   'fleet-share-w14-i5');

-- One trip of the truck, one carga per invoice (flete 100 each, linked while
-- the invoice billed it). k6 (cancelled) and k7 (priced by tariff, no flete)
-- have no trip.
insert into public.trips (id, trip_date, vehicle_id, origin, destination, revenue, cost) values
  ('00000000-0000-0000-0000-00000014b3b1', '2039-03-05', '00000000-0000-0000-0000-00000014b3e1',
   'Tigre', 'Rosario', null, 0);
insert into public.shipments
  (id, trip_id, client_id, scheduled_date, freight_amount, status, invoice_id)
values
  ('00000000-0000-0000-0000-00000014b3d1', '00000000-0000-0000-0000-00000014b3b1',
   '00000000-0000-0000-0000-00000014b3c1', '2039-03-05', 100, 'delivered',
   '00000000-0000-0000-0000-00000014b3a1'),
  ('00000000-0000-0000-0000-00000014b3d2', '00000000-0000-0000-0000-00000014b3b1',
   '00000000-0000-0000-0000-00000014b3c1', '2039-03-05', 100, 'delivered',
   '00000000-0000-0000-0000-00000014b3a2'),
  ('00000000-0000-0000-0000-00000014b3d3', '00000000-0000-0000-0000-00000014b3b1',
   '00000000-0000-0000-0000-00000014b3c1', '2039-03-05', 100, 'delivered',
   '00000000-0000-0000-0000-00000014b3a3'),
  ('00000000-0000-0000-0000-00000014b3d4', '00000000-0000-0000-0000-00000014b3b1',
   '00000000-0000-0000-0000-00000014b3c1', '2039-03-05', 100, 'delivered',
   '00000000-0000-0000-0000-00000014b3a4'),
  ('00000000-0000-0000-0000-00000014b3d5', '00000000-0000-0000-0000-00000014b3b1',
   '00000000-0000-0000-0000-00000014b3c2', '2039-03-05', 100, 'delivered',
   '00000000-0000-0000-0000-00000014b3a5'),
  ('00000000-0000-0000-0000-00000014b3d6', null,
   '00000000-0000-0000-0000-00000014b3c1', '2039-03-06', 50, 'cancelled', null),
  ('00000000-0000-0000-0000-00000014b3d7', null,
   '00000000-0000-0000-0000-00000014b3c1', '2039-03-07', null, 'not_started', null);

-- The interest charged on f4, whose ND is keyed on the charge.
insert into public.late_interest_charges
  (id, invoice_id, client_id, period_from, period_to, monthly_rate, base_amount, interest_amount, moneda)
values
  ('00000000-0000-0000-0000-00000014b3e9', '00000000-0000-0000-0000-00000014b3a4',
   '00000000-0000-0000-0000-00000014b3c1', current_date + 31, current_date + 60, 3, 121, 10, 'PES');

-- f1: a 30 % NC (36.30). f2: an ND of 12.10. f3: an NC for its total. f4: an
-- interest ND. i5: an internal NC for its total.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000014b401', 'jouve_fiscal', '00000000-0000-0000-0000-00000014b3c1',
   'nc', 'A', 3, 98151, current_date, 2, 80, '30777777778', 30, 6.30, 36.30, 'PES', 1, 3, 1,
   'emitted', 'fleet-share-w14-nc1', '00000000-0000-0000-0000-00000014b3a1'),
  ('00000000-0000-0000-0000-00000014b402', 'jouve_fiscal', '00000000-0000-0000-0000-00000014b3c1',
   'nd', 'A', 3, 98152, current_date, 2, 80, '30777777778', 10, 2.10, 12.10, 'PES', 1, 2, 1,
   'emitted', 'fleet-share-w14-nd2', '00000000-0000-0000-0000-00000014b3a2'),
  ('00000000-0000-0000-0000-00000014b403', 'jouve_fiscal', '00000000-0000-0000-0000-00000014b3c1',
   'nc', 'A', 3, 98153, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 3, 1,
   'emitted', 'fleet-share-w14-nc3', '00000000-0000-0000-0000-00000014b3a3'),
  ('00000000-0000-0000-0000-00000014b404', 'jouve_fiscal', '00000000-0000-0000-0000-00000014b3c1',
   'nd', 'A', 3, 98154, current_date, 2, 80, '30777777778', 10, 2.10, 12.10, 'PES', 1, 2, 1,
   'emitted', '00000000-0000-0000-0000-00000014b3e9', '00000000-0000-0000-0000-00000014b3a4');
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000014b405', 'jouve_internal', '00000000-0000-0000-0000-00000014b3c2',
   'nc', null, 9001, 98155, current_date, 2, 99, '0', 100, 0, 100, 'emitted',
   'fleet-share-w14-nc5', '00000000-0000-0000-0000-00000014b3a5');

-- Service role ---------------------------------------------------------------------

select results_eq(
  $$select s.id::text, round(public.shipment_invoice_billed_ratio(s.id), 4)
      from public.shipments s
     where s.id in ('00000000-0000-0000-0000-00000014b3d1', '00000000-0000-0000-0000-00000014b3d2',
                    '00000000-0000-0000-0000-00000014b3d3', '00000000-0000-0000-0000-00000014b3d4',
                    '00000000-0000-0000-0000-00000014b3d5')
     order by s.id$$,
  $$values ('00000000-0000-0000-0000-00000014b3d1', 0.7000::numeric),
           ('00000000-0000-0000-0000-00000014b3d2', 1.1000::numeric),
           ('00000000-0000-0000-0000-00000014b3d3', 0.0000::numeric),
           ('00000000-0000-0000-0000-00000014b3d4', 1.0000::numeric),
           ('00000000-0000-0000-0000-00000014b3d5', 1.0000::numeric)$$,
  'partial NC 0.7, ND 1.1, full NC 0, interest ND and internal NC 1'
);

select is(
  public.shipment_invoice_billed_ratio('00000000-0000-0000-0000-00000014b3d6'),
  null::numeric,
  'a carga with no invoice has no share'
);

select is(
  (select revenue || ':' || invoiced_revenue || ':' || uninvoiced_freight || ':' || uninvoiced_shipments
     from public.v_trip_revenue where trip_id = '00000000-0000-0000-0000-00000014b3b1'),
  '380.00:380.00:100.00:1',
  'v_trip_revenue: 70 + 110 + 100 + 100, and the carga credited in full is still to invoice'
);

create temporary table by_vehicle as
  select * from public.ai_fleet_margin('2039-03-01', '2039-03-31', 'vehicle', 50);
create temporary table by_client as
  select * from public.ai_fleet_margin('2039-03-01', '2039-03-31', 'client', 50);

select results_eq(
  $$select revenue, invoiced_revenue, net, uninvoiced_shipments from by_vehicle
     where group_key = '00000000-0000-0000-0000-00000014b3e1'$$,
  $$values (380.00::numeric, 380.00::numeric, 380.00::numeric, 1)$$,
  'ai_fleet_margin by vehicle: the truck''s revenue at each carga''s share'
);

select results_eq(
  $$select group_key, revenue, invoiced_revenue, uninvoiced_freight, uninvoiced_shipments from by_client
     where group_key in ('00000000-0000-0000-0000-00000014b3c1', '00000000-0000-0000-0000-00000014b3c2')
     order by group_key$$,
  $$values ('00000000-0000-0000-0000-00000014b3c1', 280.00::numeric, 280.00::numeric, 100.00::numeric, 1),
           ('00000000-0000-0000-0000-00000014b3c2', 100.00::numeric, 100.00::numeric, 0.00::numeric, 0)$$,
  'ai_fleet_margin by client: each client''s cargas at their share'
);

create temporary table summary as
  select * from public.ai_shipments_summary('2039-03-01', '2039-03-31');

select results_eq(
  $$select client_id::text, status, shipments, freight, invoiced, invoiced_freight, unpriced from summary
     where client_id in ('00000000-0000-0000-0000-00000014b3c1', '00000000-0000-0000-0000-00000014b3c2')
     order by client_id, status$$,
  $$values ('00000000-0000-0000-0000-00000014b3c1', 'cancelled', 1, 50::numeric, 0, 0.00::numeric, 0),
           ('00000000-0000-0000-0000-00000014b3c1', 'delivered', 4, 400::numeric, 3, 280.00::numeric, 0),
           ('00000000-0000-0000-0000-00000014b3c1', 'not_started', 1, 0::numeric, 0, 0.00::numeric, 1),
           ('00000000-0000-0000-0000-00000014b3c2', 'delivered', 1, 100::numeric, 1, 100.00::numeric, 0)$$,
  'ai_shipments_summary: invoiced freight at each share, and the cargas with no flete counted'
);

-- Operations, who reads cargas and trips but not invoices -------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000014b3f1","role":"authenticated"}', true);

select is_empty(
  $$select 1 from public.invoices where id = '00000000-0000-0000-0000-00000014b3a1'$$,
  'operations does not read the factura'
);

select is(
  (select revenue || ':' || invoiced_revenue || ':' || uninvoiced_shipments
     from public.v_trip_revenue where trip_id = '00000000-0000-0000-0000-00000014b3b1'),
  '380.00:380.00:1',
  'operations reads the same trip revenue'
);

select is(
  (select invoiced_freight from public.ai_shipments_summary('2039-03-01', '2039-03-31')
    where client_id = '00000000-0000-0000-0000-00000014b3c1' and status = 'delivered'),
  280.00::numeric,
  'operations reads the same invoiced freight'
);

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
    where p.oid = 'public.shipment_invoice_billed_ratio(uuid)'::regprocedure)
  and has_function_privilege('authenticated', 'public.shipment_invoice_billed_ratio(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.shipment_invoice_billed_ratio(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.shipment_invoice_billed_ratio(uuid)', 'execute'),
  'the share is security definer, for authenticated and the service role only'
);

select ok(
  has_function_privilege('authenticated', 'public.ai_shipments_summary(date, date)', 'execute')
  and not has_function_privilege('anon', 'public.ai_shipments_summary(date, date)', 'execute'),
  'ai_shipments_summary keeps its grants'
);

select * from finish();

rollback;
