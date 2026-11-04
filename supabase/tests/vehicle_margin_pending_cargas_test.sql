-- «Margen por camión» says when a net is not final (20261104190200):
-- get_vehicle_margin returns, as its last column, the cargas still to invoice
-- of each truck's trips and of the trips without a vehicle (a tariff-priced
-- carga has no freight until invoiced). Center rows carry 0. 2036 has no seed
-- data. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select plan(5);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.vehicles (id, patente, vehicle_type) values
  ('00000000-0000-0000-0000-0000001902e1', 'VP190AA', 'camion'),
  ('00000000-0000-0000-0000-0000001902e2', 'VP190AB', 'camion');
insert into public.cost_centers (id, code, name, vehicle_id) values
  ('00000000-0000-0000-0000-0000001902c1', 'VP-ADMIN', 'Administración VP', null);
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000001902b1', 'Caja VP', 'cash', 'ARS');
-- The freight invoice is internal, so is its client (guard_document_side).
insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000001902d1', false, null, 'Cliente VP por tarifa', null);
insert into public.invoices
  (id, channel_id, client_id, kind, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_total, moneda, cotizacion, status, idempotency_key)
values
  ('00000000-0000-0000-0000-0000001902a1', 'jouve_internal', '00000000-0000-0000-0000-0000001902d1',
   'factura', 1, 19021, '2036-03-10', 2, 80, '30777777778', 300, 300, 'PES', 1, 'emitted', 'vp-flete');

-- e1: one carga invoiced, one priced by tariff still to invoice, one
-- cancelled. e2: everything invoiced. No vehicle: two cargas to invoice.
insert into public.trips (id, trip_date, vehicle_id, origin, destination, revenue, cost) values
  ('00000000-0000-0000-0000-0000001902f1', '2036-03-05', '00000000-0000-0000-0000-0000001902e1',
   'Tigre', 'Rosario', null, 100),
  ('00000000-0000-0000-0000-0000001902f2', '2036-03-06', '00000000-0000-0000-0000-0000001902e2',
   'Rosario', 'Tigre', null, 50),
  ('00000000-0000-0000-0000-0000001902f3', '2036-03-07', null,
   'Tigre', 'Campana', null, 40);

insert into public.shipments (trip_id, client_id, freight_amount, status, invoice_id) values
  ('00000000-0000-0000-0000-0000001902f1', '00000000-0000-0000-0000-0000001902d1', 200, 'delivered',
   '00000000-0000-0000-0000-0000001902a1'),
  ('00000000-0000-0000-0000-0000001902f1', '00000000-0000-0000-0000-0000001902d1', null, 'delivered', null),
  ('00000000-0000-0000-0000-0000001902f1', '00000000-0000-0000-0000-0000001902d1', null, 'cancelled', null),
  ('00000000-0000-0000-0000-0000001902f2', '00000000-0000-0000-0000-0000001902d1', 100, 'delivered',
   '00000000-0000-0000-0000-0000001902a1'),
  ('00000000-0000-0000-0000-0000001902f3', '00000000-0000-0000-0000-0000001902d1', null, 'delivered', null),
  ('00000000-0000-0000-0000-0000001902f3', '00000000-0000-0000-0000-0000001902d1', 80, 'delivered', null);

-- A cost of a center no truck owns.
insert into public.transactions
  (account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description, cost_center_id)
values
  ('00000000-0000-0000-0000-0000001902b1', 'jouve_internal', 'expense', 70, 'ARS', '2036-03-12', '2036-03-01',
   'Gasto administración VP', '00000000-0000-0000-0000-0000001902c1');

set constraints all immediate;

-- Materialized: a volatile read used several times below.
create temporary table vm as
  select * from public.get_vehicle_margin('2036-03-01', '2036-03-31');

select results_eq(
  $$select revenue, uninvoiced_shipments from vm
     where row_kind = 'vehicle' and vehicle_id = '00000000-0000-0000-0000-0000001902e1'$$,
  $$values (200.00::numeric, 1)$$,
  'a truck counts its carga still to invoice (tariff-priced, no freight; the cancelled one left out)'
);

select is(
  (select uninvoiced_shipments from vm
    where row_kind = 'vehicle' and vehicle_id = '00000000-0000-0000-0000-0000001902e2'),
  0,
  'a truck with every carga invoiced has none pending'
);

select results_eq(
  $$select trips, revenue, uninvoiced_shipments from vm where row_kind = 'no_vehicle'$$,
  $$values (1, 0.00::numeric, 2)$$,
  'the trips without a vehicle count their cargas still to invoice'
);

select results_eq(
  $$select center_cost, uninvoiced_shipments from vm
     where row_kind = 'unlinked_center' and cost_center_id = '00000000-0000-0000-0000-0000001902c1'$$,
  $$values (70.00::numeric, 0)$$,
  'a center row has no cargas'
);

select ok(
  not has_function_privilege('authenticated', 'public.get_vehicle_margin(date, date)', 'execute')
    and not has_function_privilege('anon', 'public.get_vehicle_margin(date, date)', 'execute')
    and has_function_privilege('service_role', 'public.get_vehicle_margin(date, date)', 'execute'),
  'the function keeps its grants'
);

select * from finish();
rollback;
