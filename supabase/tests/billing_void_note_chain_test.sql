-- Audit w16 S1 F1 / S3 F1 (20261105130000): the void rule and the carga's
-- share walk the whole chain of notes under a fiscal factura. An ND whose
-- origin is an NC of the factura (the AFIP way to undo a wrong NC, imported
-- by the ARCA sync) takes that NC back, at any depth. 2041 has no seed data.
-- One transaction, rolled back.
--
-- Facturas of 121 (flete 100 each), one carga each:
-- f1: NC 121 → ND 121 on that NC. Bills 121 again: share 1, not void.
-- f2: NC 121 → ND 121 → NC 121 on that ND. The NC is back: void.
-- f3: NC 121 → ND 121 → NC 121 → ND 60.50 on that NC. Bills 60.50: 0.5.
-- f4: ND 12.10 → ND 12.10 on that ND, and NC 121 on f4. Bills 24.20: 0.2.
-- f5: NC 121 → an interest ND (keyed on its charge) on that NC. Interest
--     does not count: void.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(9);

insert into public.vehicles (id, patente, vehicle_type) values
  ('00000000-0000-0000-0000-00000016c0e1', 'VC160AA', 'camion');

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000016c0c1', true, '30777777778', 'Cliente cadena de notas w16', 'responsable_inscripto');

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, fch_vto_pago, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000016c0a1', 'jouve_fiscal', '00000000-0000-0000-0000-00000016c0c1',
   'factura', 'A', 3, 98361, current_date, current_date + 30, 2, 80, '30777777778', 100, 21, 121,
   'PES', 1, 1, 1, 'emitted', 'void-chain-w16-f1'),
  ('00000000-0000-0000-0000-00000016c0a2', 'jouve_fiscal', '00000000-0000-0000-0000-00000016c0c1',
   'factura', 'A', 3, 98362, current_date, current_date + 30, 2, 80, '30777777778', 100, 21, 121,
   'PES', 1, 1, 1, 'emitted', 'void-chain-w16-f2'),
  ('00000000-0000-0000-0000-00000016c0a3', 'jouve_fiscal', '00000000-0000-0000-0000-00000016c0c1',
   'factura', 'A', 3, 98363, current_date, current_date + 30, 2, 80, '30777777778', 100, 21, 121,
   'PES', 1, 1, 1, 'emitted', 'void-chain-w16-f3'),
  ('00000000-0000-0000-0000-00000016c0a4', 'jouve_fiscal', '00000000-0000-0000-0000-00000016c0c1',
   'factura', 'A', 3, 98364, current_date, current_date + 30, 2, 80, '30777777778', 100, 21, 121,
   'PES', 1, 1, 1, 'emitted', 'void-chain-w16-f4'),
  ('00000000-0000-0000-0000-00000016c0a5', 'jouve_fiscal', '00000000-0000-0000-0000-00000016c0c1',
   'factura', 'A', 3, 98365, current_date, current_date + 30, 2, 80, '30777777778', 100, 21, 121,
   'PES', 1, 1, 1, 'emitted', 'void-chain-w16-f5');

-- One trip, one carga per factura.
insert into public.trips (id, trip_date, vehicle_id, origin, destination, revenue, cost) values
  ('00000000-0000-0000-0000-00000016c0b1', '2041-04-05', '00000000-0000-0000-0000-00000016c0e1',
   'Tigre', 'Rosario', null, 0);
insert into public.shipments
  (id, trip_id, client_id, scheduled_date, freight_amount, status, invoice_id)
values
  ('00000000-0000-0000-0000-00000016c0d1', '00000000-0000-0000-0000-00000016c0b1',
   '00000000-0000-0000-0000-00000016c0c1', '2041-04-05', 100, 'delivered',
   '00000000-0000-0000-0000-00000016c0a1'),
  ('00000000-0000-0000-0000-00000016c0d2', '00000000-0000-0000-0000-00000016c0b1',
   '00000000-0000-0000-0000-00000016c0c1', '2041-04-05', 100, 'delivered',
   '00000000-0000-0000-0000-00000016c0a2'),
  ('00000000-0000-0000-0000-00000016c0d3', '00000000-0000-0000-0000-00000016c0b1',
   '00000000-0000-0000-0000-00000016c0c1', '2041-04-05', 100, 'delivered',
   '00000000-0000-0000-0000-00000016c0a3'),
  ('00000000-0000-0000-0000-00000016c0d4', '00000000-0000-0000-0000-00000016c0b1',
   '00000000-0000-0000-0000-00000016c0c1', '2041-04-05', 100, 'delivered',
   '00000000-0000-0000-0000-00000016c0a4'),
  ('00000000-0000-0000-0000-00000016c0d5', '00000000-0000-0000-0000-00000016c0b1',
   '00000000-0000-0000-0000-00000016c0c1', '2041-04-05', 100, 'delivered',
   '00000000-0000-0000-0000-00000016c0a5');

-- The interest charged on f5; its ND is keyed on the charge.
insert into public.late_interest_charges
  (id, invoice_id, client_id, period_from, period_to, monthly_rate, base_amount, interest_amount, moneda)
values
  ('00000000-0000-0000-0000-00000016c0e9', '00000000-0000-0000-0000-00000016c0a5',
   '00000000-0000-0000-0000-00000016c0c1', current_date + 31, current_date + 60, 3, 121, 10, 'PES');

-- The notes, one level of the chain per statement.
-- Level 1: an NC of 121 on f1, f2, f3 and f5; on f4 an ND of 12.10 and an NC
-- of 121.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000016c101', 'jouve_fiscal', '00000000-0000-0000-0000-00000016c0c1',
   'nc', 'A', 3, 98371, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 3, 1,
   'emitted', 'void-chain-w16-n1', '00000000-0000-0000-0000-00000016c0a1'),
  ('00000000-0000-0000-0000-00000016c102', 'jouve_fiscal', '00000000-0000-0000-0000-00000016c0c1',
   'nc', 'A', 3, 98372, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 3, 1,
   'emitted', 'void-chain-w16-n2', '00000000-0000-0000-0000-00000016c0a2'),
  ('00000000-0000-0000-0000-00000016c103', 'jouve_fiscal', '00000000-0000-0000-0000-00000016c0c1',
   'nc', 'A', 3, 98373, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 3, 1,
   'emitted', 'void-chain-w16-n3', '00000000-0000-0000-0000-00000016c0a3'),
  ('00000000-0000-0000-0000-00000016c104', 'jouve_fiscal', '00000000-0000-0000-0000-00000016c0c1',
   'nd', 'A', 3, 98374, current_date, 2, 80, '30777777778', 10, 2.10, 12.10, 'PES', 1, 2, 1,
   'emitted', 'void-chain-w16-d4', '00000000-0000-0000-0000-00000016c0a4'),
  ('00000000-0000-0000-0000-00000016c1a4', 'jouve_fiscal', '00000000-0000-0000-0000-00000016c0c1',
   'nc', 'A', 3, 98375, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 3, 1,
   'emitted', 'void-chain-w16-n4', '00000000-0000-0000-0000-00000016c0a4'),
  ('00000000-0000-0000-0000-00000016c105', 'jouve_fiscal', '00000000-0000-0000-0000-00000016c0c1',
   'nc', 'A', 3, 98376, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 3, 1,
   'emitted', 'void-chain-w16-n5', '00000000-0000-0000-0000-00000016c0a5');

-- Level 2: an ND of 121 on the NCs of f1, f2 and f3; an ND of 12.10 on f4's
-- ND; the interest ND of 10 on f5's NC.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000016c201', 'jouve_fiscal', '00000000-0000-0000-0000-00000016c0c1',
   'nd', 'A', 3, 98381, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 2, 1,
   'emitted', 'void-chain-w16-d1', '00000000-0000-0000-0000-00000016c101'),
  ('00000000-0000-0000-0000-00000016c202', 'jouve_fiscal', '00000000-0000-0000-0000-00000016c0c1',
   'nd', 'A', 3, 98382, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 2, 1,
   'emitted', 'void-chain-w16-d2', '00000000-0000-0000-0000-00000016c102'),
  ('00000000-0000-0000-0000-00000016c203', 'jouve_fiscal', '00000000-0000-0000-0000-00000016c0c1',
   'nd', 'A', 3, 98383, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 2, 1,
   'emitted', 'void-chain-w16-d3', '00000000-0000-0000-0000-00000016c103'),
  ('00000000-0000-0000-0000-00000016c204', 'jouve_fiscal', '00000000-0000-0000-0000-00000016c0c1',
   'nd', 'A', 3, 98384, current_date, 2, 80, '30777777778', 10, 2.10, 12.10, 'PES', 1, 2, 1,
   'emitted', 'void-chain-w16-d4b', '00000000-0000-0000-0000-00000016c104'),
  ('00000000-0000-0000-0000-00000016c205', 'jouve_fiscal', '00000000-0000-0000-0000-00000016c0c1',
   'nd', 'A', 3, 98385, current_date, 2, 80, '30777777778', 10, 0, 10, 'PES', 1, 2, 1,
   'emitted', '00000000-0000-0000-0000-00000016c0e9', '00000000-0000-0000-0000-00000016c105');

-- Level 3: an NC of 121 on the NDs of f2 and f3.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000016c302', 'jouve_fiscal', '00000000-0000-0000-0000-00000016c0c1',
   'nc', 'A', 3, 98392, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 3, 1,
   'emitted', 'void-chain-w16-n2b', '00000000-0000-0000-0000-00000016c202'),
  ('00000000-0000-0000-0000-00000016c303', 'jouve_fiscal', '00000000-0000-0000-0000-00000016c0c1',
   'nc', 'A', 3, 98393, current_date, 2, 80, '30777777778', 100, 21, 121, 'PES', 1, 3, 1,
   'emitted', 'void-chain-w16-n3b', '00000000-0000-0000-0000-00000016c203');

-- Level 4: an ND of 60.50 on f3's last NC.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000016c403', 'jouve_fiscal', '00000000-0000-0000-0000-00000016c0c1',
   'nd', 'A', 3, 98394, current_date, 2, 80, '30777777778', 50, 10.50, 60.50, 'PES', 1, 2, 1,
   'emitted', 'void-chain-w16-d3c', '00000000-0000-0000-0000-00000016c303');

select results_eq(
  $$select s.id::text, round(public.shipment_invoice_billed_ratio(s.id), 4)
      from public.shipments s
     where s.client_id = '00000000-0000-0000-0000-00000016c0c1'
     order by s.id$$,
  $$values ('00000000-0000-0000-0000-00000016c0d1', 1.0000::numeric),
           ('00000000-0000-0000-0000-00000016c0d2', 0.0000::numeric),
           ('00000000-0000-0000-0000-00000016c0d3', 0.5000::numeric),
           ('00000000-0000-0000-0000-00000016c0d4', 0.2000::numeric),
           ('00000000-0000-0000-0000-00000016c0d5', 0.0000::numeric)$$,
  'an ND on the NC takes it back (1); the NC back again (0); deeper (0.5); ND on ND (0.2); interest ND on the NC (0)'
);

select results_eq(
  $$select i.id::text, public.billing_invoice_is_void(i.id), public.storage_invoice_is_void(i.id)
      from public.invoices i
     where i.client_id = '00000000-0000-0000-0000-00000016c0c1' and i.kind = 'factura'
     order by i.id$$,
  $$values ('00000000-0000-0000-0000-00000016c0a1', false, false),
           ('00000000-0000-0000-0000-00000016c0a2', true, true),
           ('00000000-0000-0000-0000-00000016c0a3', false, false),
           ('00000000-0000-0000-0000-00000016c0a4', false, false),
           ('00000000-0000-0000-0000-00000016c0a5', true, true)$$,
  'void only when the whole chain leaves the factura billing nothing'
);

select is(
  (select array_agg(id::text order by id) from public.billing_void_invoice_ids(array[
     '00000000-0000-0000-0000-00000016c0a1', '00000000-0000-0000-0000-00000016c0a2',
     '00000000-0000-0000-0000-00000016c0a3', '00000000-0000-0000-0000-00000016c0a4',
     '00000000-0000-0000-0000-00000016c0a5']::uuid[]) as t(id)),
  array['00000000-0000-0000-0000-00000016c0a2', '00000000-0000-0000-0000-00000016c0a5'],
  'the cargas list offers «Facturar flete» only where the chain voids the factura'
);

-- f3's chain bottom-up: ND 60.50; NC 121 − 60.50; ND 121 − 60.50;
-- NC 121 − 60.50; factura 121 − 60.50.
select results_eq(
  $$select i.id::text, public.billing_invoice_live_amount(i.id)
      from public.invoices i
     where i.id in ('00000000-0000-0000-0000-00000016c0a3', '00000000-0000-0000-0000-00000016c103',
                    '00000000-0000-0000-0000-00000016c203', '00000000-0000-0000-0000-00000016c303')
     order by i.id$$,
  $$values ('00000000-0000-0000-0000-00000016c0a3', 60.50::numeric),
           ('00000000-0000-0000-0000-00000016c103', 60.50::numeric),
           ('00000000-0000-0000-0000-00000016c203', 60.50::numeric),
           ('00000000-0000-0000-0000-00000016c303', 60.50::numeric)$$,
  'each comprobante of the chain nets its own notes'
);

select is(
  public.billing_invoice_live_amount('00000000-0000-0000-0000-00000016c0ff'),
  null::numeric,
  'null for a comprobante that does not exist'
);

select throws_ok(
  $$update public.shipments set freight_amount = 200
     where id = '00000000-0000-0000-0000-00000016c0d1'$$,
  '55006',
  'La carga ya está facturada: para cambiar cliente, canal, ruta o flete, anulá la factura si es interna, o emití una nota de crédito por el total si es fiscal.',
  'the carga whose NC an ND took back stays billed'
);

select lives_ok(
  $$update public.shipments set freight_amount = 200
     where id = '00000000-0000-0000-0000-00000016c0d2'$$,
  'the carga whose chain voids its factura is free again'
);

select is(
  (select revenue || ':' || invoiced_revenue || ':' || uninvoiced_freight || ':' || uninvoiced_shipments
     from public.v_trip_revenue where trip_id = '00000000-0000-0000-0000-00000016c0b1'),
  '170.00:170.00:300.00:2',
  'v_trip_revenue: 100 + 50 + 20, and the two voided cargas (one now 200) still to invoice'
);

select ok(
  not (select p.prosecdef from pg_proc p
        where p.oid = 'public.billing_invoice_live_amount(uuid)'::regprocedure)
  and (select p.proconfig @> array['search_path=""'] from pg_proc p
        where p.oid = 'public.billing_invoice_live_amount(uuid)'::regprocedure)
  and has_function_privilege('authenticated', 'public.billing_invoice_live_amount(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.billing_invoice_live_amount(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.billing_invoice_live_amount(uuid)', 'execute')
  and to_regprocedure('public.billing_invoice_live_debits(uuid)') is null,
  'the chain helper is invoker, for authenticated and the service role only; the first-level helper is gone'
);

select * from finish();

rollback;
