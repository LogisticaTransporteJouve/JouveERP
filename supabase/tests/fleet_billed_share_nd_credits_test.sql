-- Audit w15 S3 F1 / F2 (20261105120100): a freight ND counts net of the NCs
-- issued against it (an NC whose origin is the ND, as the ARCA sync imports
-- one), in the carga's share and in the void rule. An NC for the factura's
-- total leaves it billing a live freight ND's part, and the carga stays
-- billed; an NC on the ND too makes it void. An interest ND still does not
-- count. v_trip_revenue, ai_fleet_margin and ai_shipments_summary agree,
-- for the service role and for operations. 2040 has no seed data. One
-- transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000015b3f1', 'ops@fleet-share-w15.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-00000015b3f1', 'operations');

insert into public.vehicles (id, patente, vehicle_type) values
  ('00000000-0000-0000-0000-00000015b3e1', 'FS150AA', 'camion');

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000015b3c1', true, '30777777778', 'Cliente flota ND w15', 'responsable_inscripto');

-- f1..f5: fiscal facturas of 121 (100 + IVA).
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, fch_vto_pago, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000015b3a1', 'jouve_fiscal', '00000000-0000-0000-0000-00000015b3c1',
   'factura', 'A', 3, 98161, current_date, current_date + 30, 2, 80, '30777777778', 100, 21, 121,
   'PES', 1, 1, 1, 'emitted', 'fleet-share-w15-f1'),
  ('00000000-0000-0000-0000-00000015b3a2', 'jouve_fiscal', '00000000-0000-0000-0000-00000015b3c1',
   'factura', 'A', 3, 98162, current_date, current_date + 30, 2, 80, '30777777778', 100, 21, 121,
   'PES', 1, 1, 1, 'emitted', 'fleet-share-w15-f2'),
  ('00000000-0000-0000-0000-00000015b3a3', 'jouve_fiscal', '00000000-0000-0000-0000-00000015b3c1',
   'factura', 'A', 3, 98163, current_date, current_date + 30, 2, 80, '30777777778', 100, 21, 121,
   'PES', 1, 1, 1, 'emitted', 'fleet-share-w15-f3'),
  ('00000000-0000-0000-0000-00000015b3a4', 'jouve_fiscal', '00000000-0000-0000-0000-00000015b3c1',
   'factura', 'A', 3, 98164, current_date, current_date + 30, 2, 80, '30777777778', 100, 21, 121,
   'PES', 1, 1, 1, 'emitted', 'fleet-share-w15-f4'),
  ('00000000-0000-0000-0000-00000015b3a5', 'jouve_fiscal', '00000000-0000-0000-0000-00000015b3c1',
   'factura', 'A', 3, 98165, current_date, current_date + 30, 2, 80, '30777777778', 100, 21, 121,
   'PES', 1, 1, 1, 'emitted', 'fleet-share-w15-f5');

-- One trip of the truck, one carga per factura (flete 100 each).
insert into public.trips (id, trip_date, vehicle_id, origin, destination, revenue, cost) values
  ('00000000-0000-0000-0000-00000015b3b1', '2040-04-05', '00000000-0000-0000-0000-00000015b3e1',
   'Tigre', 'Rosario', null, 0);
insert into public.shipments
  (id, trip_id, client_id, scheduled_date, freight_amount, status, invoice_id)
values
  ('00000000-0000-0000-0000-00000015b3d1', '00000000-0000-0000-0000-00000015b3b1',
   '00000000-0000-0000-0000-00000015b3c1', '2040-04-05', 100, 'delivered',
   '00000000-0000-0000-0000-00000015b3a1'),
  ('00000000-0000-0000-0000-00000015b3d2', '00000000-0000-0000-0000-00000015b3b1',
   '00000000-0000-0000-0000-00000015b3c1', '2040-04-05', 100, 'delivered',
   '00000000-0000-0000-0000-00000015b3a2'),
  ('00000000-0000-0000-0000-00000015b3d3', '00000000-0000-0000-0000-00000015b3b1',
   '00000000-0000-0000-0000-00000015b3c1', '2040-04-05', 100, 'delivered',
   '00000000-0000-0000-0000-00000015b3a3'),
  ('00000000-0000-0000-0000-00000015b3d4', '00000000-0000-0000-0000-00000015b3b1',
   '00000000-0000-0000-0000-00000015b3c1', '2040-04-05', 100, 'delivered',
   '00000000-0000-0000-0000-00000015b3a4'),
  ('00000000-0000-0000-0000-00000015b3d5', '00000000-0000-0000-0000-00000015b3b1',
   '00000000-0000-0000-0000-00000015b3c1', '2040-04-05', 100, 'delivered',
   '00000000-0000-0000-0000-00000015b3a5');

-- The interest charged on f5, whose ND is keyed on the charge.
insert into public.late_interest_charges
  (id, invoice_id, client_id, period_from, period_to, monthly_rate, base_amount, interest_amount, moneda)
values
  ('00000000-0000-0000-0000-00000015b3e9', '00000000-0000-0000-0000-00000015b3a5',
   '00000000-0000-0000-0000-00000015b3c1', current_date + 31, current_date + 60, 3, 121, 10, 'PES');

-- An ND of 12.10 on each factura (d5 is the interest ND).
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000015b401', 'jouve_fiscal', '00000000-0000-0000-0000-00000015b3c1',
   'nd', 'A', 3, 98171, current_date, 2, 80, '30777777778', 10, 2.10, 12.10, 'PES', 1, 2, 1,
   'emitted', 'fleet-share-w15-d1', '00000000-0000-0000-0000-00000015b3a1'),
  ('00000000-0000-0000-0000-00000015b402', 'jouve_fiscal', '00000000-0000-0000-0000-00000015b3c1',
   'nd', 'A', 3, 98172, current_date, 2, 80, '30777777778', 10, 2.10, 12.10, 'PES', 1, 2, 1,
   'emitted', 'fleet-share-w15-d2', '00000000-0000-0000-0000-00000015b3a2'),
  ('00000000-0000-0000-0000-00000015b403', 'jouve_fiscal', '00000000-0000-0000-0000-00000015b3c1',
   'nd', 'A', 3, 98173, current_date, 2, 80, '30777777778', 10, 2.10, 12.10, 'PES', 1, 2, 1,
   'emitted', 'fleet-share-w15-d3', '00000000-0000-0000-0000-00000015b3a3'),
  ('00000000-0000-0000-0000-00000015b404', 'jouve_fiscal', '00000000-0000-0000-0000-00000015b3c1',
   'nd', 'A', 3, 98174, current_date, 2, 80, '30777777778', 10, 2.10, 12.10, 'PES', 1, 2, 1,
   'emitted', 'fleet-share-w15-d4', '00000000-0000-0000-0000-00000015b3a4'),
  ('00000000-0000-0000-0000-00000015b405', 'jouve_fiscal', '00000000-0000-0000-0000-00000015b3c1',
   'nd', 'A', 3, 98175, current_date, 2, 80, '30777777778', 10, 2.10, 12.10, 'PES', 1, 2, 1,
   'emitted', '00000000-0000-0000-0000-00000015b3e9', '00000000-0000-0000-0000-00000015b3a5');

-- The NCs:
-- n1: 12.10 on d1 (the ND credited in full, imported with CbtesAsoc = d1).
-- n2: 6.05 on d2 (half the ND).
-- n3: 121 on f3 (the factura in full; d3 still owed).
-- n4: 121 on f4 and n4b 12.10 on d4 (both in full).
-- n5: 121 on f5 (in full; d5 is interest).
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000015b411', 'jouve_fiscal', '00000000-0000-0000-0000-00000015b3c1',
   'nc', 'A', 3, 98181, current_date, 2, 80, '30777777778', 10, 2.10, 12.10, 'PES', 1, 3, 1,
   'emitted', 'fleet-share-w15-n1', '00000000-0000-0000-0000-00000015b401'),
  ('00000000-0000-0000-0000-00000015b412', 'jouve_fiscal', '00000000-0000-0000-0000-00000015b3c1',
   'nc', 'A', 3, 98182, current_date, 2, 80, '30777777778', 5, 1.05, 6.05, 'PES', 1, 3, 1,
   'emitted', 'fleet-share-w15-n2', '00000000-0000-0000-0000-00000015b402'),
  ('00000000-0000-0000-0000-00000015b413', 'jouve_fiscal', '00000000-0000-0000-0000-00000015b3c1',
   'nc', 'A', 3, 98183, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 3, 1,
   'emitted', 'fleet-share-w15-n3', '00000000-0000-0000-0000-00000015b3a3'),
  ('00000000-0000-0000-0000-00000015b414', 'jouve_fiscal', '00000000-0000-0000-0000-00000015b3c1',
   'nc', 'A', 3, 98184, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 3, 1,
   'emitted', 'fleet-share-w15-n4', '00000000-0000-0000-0000-00000015b3a4'),
  ('00000000-0000-0000-0000-00000015b415', 'jouve_fiscal', '00000000-0000-0000-0000-00000015b3c1',
   'nc', 'A', 3, 98185, current_date, 2, 80, '30777777778', 10, 2.10, 12.10, 'PES', 1, 3, 1,
   'emitted', 'fleet-share-w15-n4b', '00000000-0000-0000-0000-00000015b404'),
  ('00000000-0000-0000-0000-00000015b416', 'jouve_fiscal', '00000000-0000-0000-0000-00000015b3c1',
   'nc', 'A', 3, 98186, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 3, 1,
   'emitted', 'fleet-share-w15-n5', '00000000-0000-0000-0000-00000015b3a5');

-- Service role ---------------------------------------------------------------------

select results_eq(
  $$select s.id::text, round(public.shipment_invoice_billed_ratio(s.id), 4)
      from public.shipments s
     where s.client_id = '00000000-0000-0000-0000-00000015b3c1'
     order by s.id$$,
  $$values ('00000000-0000-0000-0000-00000015b3d1', 1.0000::numeric),
           ('00000000-0000-0000-0000-00000015b3d2', 1.0500::numeric),
           ('00000000-0000-0000-0000-00000015b3d3', 0.1000::numeric),
           ('00000000-0000-0000-0000-00000015b3d4', 0.0000::numeric),
           ('00000000-0000-0000-0000-00000015b3d5', 0.0000::numeric)$$,
  'ND credited by its own NC 1, half credited 1.05, factura credited with the ND owed 0.1, both credited 0, interest ND 0'
);

select results_eq(
  $$select i.id::text, public.billing_invoice_is_void(i.id), public.storage_invoice_is_void(i.id)
      from public.invoices i
     where i.id in ('00000000-0000-0000-0000-00000015b3a1', '00000000-0000-0000-0000-00000015b3a3',
                    '00000000-0000-0000-0000-00000015b3a4', '00000000-0000-0000-0000-00000015b3a5')
     order by i.id$$,
  $$values ('00000000-0000-0000-0000-00000015b3a1', false, false),
           ('00000000-0000-0000-0000-00000015b3a3', false, false),
           ('00000000-0000-0000-0000-00000015b3a4', true, true),
           ('00000000-0000-0000-0000-00000015b3a5', true, true)$$,
  'void only when the NCs cover the factura and its live freight NDs; an interest ND does not hold it'
);

select is(
  (select array_agg(id::text order by id) from public.billing_void_invoice_ids(array[
     '00000000-0000-0000-0000-00000015b3a3', '00000000-0000-0000-0000-00000015b3a4']::uuid[]) as t(id)),
  array['00000000-0000-0000-0000-00000015b3a4'],
  'the cargas list offers «Facturar flete» again only for the factura credited with its ND'
);

select is(
  public.billing_invoice_live_debits('00000000-0000-0000-0000-00000015b3a2'),
  6.05::numeric,
  'an ND counts net of its own NCs'
);

select throws_ok(
  $$update public.shipments set freight_amount = 200
     where id = '00000000-0000-0000-0000-00000015b3d3'$$,
  '55006',
  'La carga ya está facturada: para cambiar cliente, canal, ruta o flete, anulá la factura si es interna, o emití una nota de crédito por el total si es fiscal.',
  'the carga whose factura is credited but whose ND is owed stays billed'
);

select is(
  (select revenue || ':' || invoiced_revenue || ':' || uninvoiced_freight || ':' || uninvoiced_shipments
     from public.v_trip_revenue where trip_id = '00000000-0000-0000-0000-00000015b3b1'),
  '215.00:215.00:200.00:2',
  'v_trip_revenue: 100 + 105 + 10, and the two cargas credited in full still to invoice'
);

create temporary table by_vehicle as
  select * from public.ai_fleet_margin('2040-04-01', '2040-04-30', 'vehicle', 50);

select results_eq(
  $$select revenue, invoiced_revenue, uninvoiced_shipments from by_vehicle
     where group_key = '00000000-0000-0000-0000-00000015b3e1'$$,
  $$values (215.00::numeric, 215.00::numeric, 2)$$,
  'ai_fleet_margin by vehicle: the same revenue'
);

select is(
  (select invoiced_freight from public.ai_shipments_summary('2040-04-01', '2040-04-30')
    where client_id = '00000000-0000-0000-0000-00000015b3c1' and status = 'delivered'),
  215.00::numeric,
  'ai_shipments_summary: the same invoiced freight'
);

-- Operations, who reads cargas and trips but not invoices -------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000015b3f1","role":"authenticated"}', true);

select is(
  (select revenue || ':' || invoiced_revenue || ':' || uninvoiced_shipments
     from public.v_trip_revenue where trip_id = '00000000-0000-0000-0000-00000015b3b1'),
  '215.00:215.00:2',
  'operations reads the same trip revenue'
);

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select ok(
  not (select p.prosecdef from pg_proc p
        where p.oid = 'public.billing_invoice_live_debits(uuid)'::regprocedure)
  and (select p.proconfig @> array['search_path=""'] from pg_proc p
        where p.oid = 'public.billing_invoice_live_debits(uuid)'::regprocedure)
  and has_function_privilege('authenticated', 'public.billing_invoice_live_debits(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.billing_invoice_live_debits(uuid)', 'execute'),
  'the ND helper is invoker, for authenticated and the service role only'
);

select ok(
  (select p.prosecdef from pg_proc p
    where p.oid = 'public.shipment_invoice_billed_ratio(uuid)'::regprocedure)
  and has_function_privilege('authenticated', 'public.shipment_invoice_billed_ratio(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.shipment_invoice_billed_ratio(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.billing_invoice_is_void(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.billing_invoice_is_void(uuid)', 'execute'),
  'the share and the rule keep their grants'
);

select * from finish();

rollback;
