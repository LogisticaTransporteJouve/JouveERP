-- Margen por camión (20261103230000): a cost center links to at most one
-- truck; get_vehicle_margin adds to each truck what was loaded with its
-- center, without counting twice a purchase a fuel load already carries, and
-- keeps apart what no truck owns (trips without a vehicle, centers without a
-- truck); ai_fleet_margin no longer counts cancelled trips. 1994 has no seed
-- data. One transaction, rolled back.

begin;

select plan(13);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000002300f1', 'finance@vehicle-margin.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000002300f1', 'finance');

insert into public.vehicles (id, patente, vehicle_type) values
  ('00000000-0000-0000-0000-0000002300a1', 'VM94001', 'camion'),
  ('00000000-0000-0000-0000-0000002300a2', 'VM94002', 'camion');

insert into public.cost_centers (id, code, name, vehicle_id) values
  ('00000000-0000-0000-0000-0000002300c1', 'VM-CAMION-1', 'Camión VM 1', '00000000-0000-0000-0000-0000002300a1'),
  ('00000000-0000-0000-0000-0000002300c2', 'VM-ADMIN', 'Administración VM', null);

select throws_ok(
  $$insert into public.cost_centers (code, name, vehicle_id)
    values ('VM-CAMION-1B', 'Otro centro', '00000000-0000-0000-0000-0000002300a1')$$,
  '23505',
  null,
  'a truck has at most one cost center'
);

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000002300b1', 'Caja VM', 'cash', 'ARS');
insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000002300d1', '30777777773', 'Proveedor VM', 'responsable_inscripto');

insert into public.trips (id, trip_date, vehicle_id, origin, destination, revenue, cost, status) values
  ('00000000-0000-0000-0000-0000002300e1', '1994-03-05', '00000000-0000-0000-0000-0000002300a1',
   'Tigre', 'Rosario', 1000, 100, 'completed'),
  ('00000000-0000-0000-0000-0000002300e2', '1994-03-06', '00000000-0000-0000-0000-0000002300a1',
   'Rosario', 'Tigre', 5000, 500, 'cancelled'),
  ('00000000-0000-0000-0000-0000002300e3', '1994-03-07', null,
   'Tigre', 'Campana', 40, 10, 'completed'),
  ('00000000-0000-0000-0000-0000002300e4', '1994-03-08', '00000000-0000-0000-0000-0000002300a2',
   'Tigre', 'Zárate', 200, 0, 'completed');

-- The fuel purchase carries the truck's center and a fuel load points at it:
-- the fleet side counts it, the center part must not.
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, imp_neto, imp_total, status,
   cost_center_id)
values
  ('00000000-0000-0000-0000-000000230011', 'jouve_fiscal', '00000000-0000-0000-0000-0000002300d1',
   'factura', 'A', 1, 230011, '1994-03-10', 300, 300, 'received', '00000000-0000-0000-0000-0000002300c1');

insert into public.fuel_loads (vehicle_id, load_date, liters, amount, purchase_invoice_id) values
  ('00000000-0000-0000-0000-0000002300a1', '1994-03-10', 100, 300, '00000000-0000-0000-0000-000000230011');

insert into public.maintenance_records (vehicle_id, service_date, kind, description, cost) values
  ('00000000-0000-0000-0000-0000002300a1', '1994-03-15', 'service', 'Service VM', 50);

-- Insurance of the truck (its center), a loose cost of administration.
insert into public.transactions
  (account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description, cost_center_id)
values
  ('00000000-0000-0000-0000-0000002300b1', 'jouve_fiscal', 'expense', 400, 'ARS', '1994-03-12', '1994-03-01',
   'Seguro camión VM', '00000000-0000-0000-0000-0000002300c1'),
  ('00000000-0000-0000-0000-0000002300b1', 'jouve_internal', 'expense', 70, 'ARS', '1994-03-12', '1994-03-01',
   'Gasto administración VM', '00000000-0000-0000-0000-0000002300c2');

set constraints all immediate;

-- Materialized: volatile reads used several times below.
create temp table fleet as
select * from public.ai_fleet_margin('1994-03-01', '1994-03-31', 'vehicle', 50, null);
create temp table vm as
select * from public.get_vehicle_margin('1994-03-10', '1994-03-20');
create temp table pnl as
select * from public.get_management_pnl('1994-03-01', '1994-03-31', 'accrual', false);

-- ai_fleet_margin ----------------------------------------------------------------------

select results_eq(
  $$select trips, revenue, trip_cost, fuel_cost, maintenance_cost
      from fleet where group_key = '00000000-0000-0000-0000-0000002300a1'$$,
  $$values (1, 1000.00::numeric, 100.00::numeric, 300.00::numeric, 50.00::numeric)$$,
  'ai_fleet_margin leaves out the cancelled trip (its revenue and its cost)'
);

-- get_vehicle_margin -------------------------------------------------------------------

select results_eq(
  $$select trips, revenue, trip_cost, fuel_cost, maintenance_cost, center_cost, net, cost_center_id
      from vm where row_kind = 'vehicle' and vehicle_id = '00000000-0000-0000-0000-0000002300a1'$$,
  $$values (1, 1000.00::numeric, 100.00::numeric, 300.00::numeric, 50.00::numeric, 400.00::numeric,
            150.00::numeric, '00000000-0000-0000-0000-0000002300c1'::uuid)$$,
  'a truck: its trips, fuel and service, plus its center''s insurance (not the fuel purchase again), over whole months'
);

select results_eq(
  $$select center_cost, net, cost_center_id is null
      from vm where row_kind = 'vehicle' and vehicle_id = '00000000-0000-0000-0000-0000002300a2'$$,
  $$values (0.00::numeric, 200.00::numeric, true)$$,
  'a truck without a center carries only its fleet figures'
);

select results_eq(
  $$select trips, revenue, trip_cost, net from vm where row_kind = 'no_vehicle'$$,
  $$values (1, 40.00::numeric, 10.00::numeric, 30.00::numeric)$$,
  'trips without a vehicle come apart'
);

select results_eq(
  $$select center_cost, net from vm
     where row_kind = 'unlinked_center' and cost_center_id = '00000000-0000-0000-0000-0000002300c2'$$,
  $$values (70.00::numeric, -70.00::numeric)$$,
  'a center without a truck comes apart, never spread across trucks'
);

select is(
  (select count(*)::int from vm
    where row_kind <> 'vehicle' and cost_center_id = '00000000-0000-0000-0000-0000002300c1'),
  0,
  'the truck''s center does not show again as unattributed'
);

select is(
  (select coalesce(sum(center_cost), 0) from vm) + 300,
  (select -coalesce(sum(amount_ars), 0) from pnl where bucket = 'operating_cost'),
  'every operating cost of gestión is in some row once, but the purchase the fuel load carries'
);

select is(
  (select count(*)::int from vm where row_kind = 'vehicle'),
  (select count(distinct vehicle_id)::int from vm where row_kind = 'vehicle'),
  'one row per truck'
);

-- Links and guards -----------------------------------------------------------------------

select is(
  (select vehicle_id from public.cost_centers where id = '00000000-0000-0000-0000-0000002300c1'),
  '00000000-0000-0000-0000-0000002300a1'::uuid,
  'the center keeps its truck'
);

reset role;

select throws_ok(
  $$select * from public.get_vehicle_margin('1994-04-01', '1994-03-01')$$,
  '22023',
  'Período inválido',
  'an inverted range is rejected'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000002300f1","role":"authenticated"}', true);

select throws_ok(
  $$select * from public.get_vehicle_margin('1994-03-01', '1994-03-31')$$,
  '42501',
  null,
  'authenticated cannot call it directly (the action gates on management:read)'
);

select lives_ok(
  $$select vehicle_id from public.cost_centers limit 1$$,
  'the link is readable with the centers'
);

reset role;

select * from finish();
rollback;
