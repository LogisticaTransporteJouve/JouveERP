-- Margen por camión (20261104150201): the NC/ND of a purchase that a service
-- links counts in the truck's center, as in Gestión, and the linked purchase
-- itself is still not counted twice. 1996 has no seed data. One transaction,
-- rolled back.

begin;

select plan(3);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.vehicles (id, patente, vehicle_type) values
  ('00000000-0000-0000-0000-0000001502a1', 'VN96001', 'camion');
insert into public.cost_centers (id, code, name, vehicle_id) values
  ('00000000-0000-0000-0000-0000001502c5', 'VN-CAMION-1', 'Camión VN 1', '00000000-0000-0000-0000-0000001502a1');
insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000001502b5', '30777777775', 'Taller VN', 'responsable_inscripto');

-- A postable expense leaf with no management_buckets row, so the center
-- part reads it whatever the seeded buckets are.
insert into public.chart_of_accounts (id, code, name, level, account_type) values
  ('00000000-0000-0000-0000-0000001502d5', '96', 'Gasto VN sin rubro', 1, 'resultado_negativo');
delete from public.management_buckets
 where chart_of_accounts_id = '00000000-0000-0000-0000-0000001502d5';

-- The workshop's factura of 1000, with the truck's center; the service
-- carries it (the fleet side counts the service's cost).
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, imp_neto, imp_total, status,
   account_id, cost_center_id)
values
  ('00000000-0000-0000-0000-0000001502f5', 'jouve_fiscal', '00000000-0000-0000-0000-0000001502b5',
   'factura', 'A', 16, 1, '1996-06-10', 1000, 1000, 'received',
   '00000000-0000-0000-0000-0000001502d5', '00000000-0000-0000-0000-0000001502c5');

insert into public.maintenance_records
  (vehicle_id, service_date, kind, description, cost, purchase_invoice_id)
values
  ('00000000-0000-0000-0000-0000001502a1', '1996-06-10', 'service', 'Service VN', 1000,
   '00000000-0000-0000-0000-0000001502f5');

-- Later, an NC of 200 against it. It inherits the factura's account and
-- center (purchase_nc_nd_inherit_account).
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, imp_neto, imp_total, status,
   invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000001502f6', 'jouve_fiscal', '00000000-0000-0000-0000-0000001502b5',
   'nc', 'A', 16, 2, '1996-06-20', 200, 200, 'received', '00000000-0000-0000-0000-0000001502f5');

set constraints all immediate;

create temp table vm as
select * from public.get_vehicle_margin('1996-06-01', '1996-06-30');
create temp table pnl as
select * from public.management_pnl_lines('1996-06-01', '1996-06-30', 'accrual')
 where cost_center_id = '00000000-0000-0000-0000-0000001502c5';

select results_eq(
  $$select maintenance_cost, center_cost, net from vm
     where row_kind = 'vehicle' and vehicle_id = '00000000-0000-0000-0000-0000001502a1'$$,
  $$values (1000.00::numeric, -200.00::numeric, -800.00::numeric)$$,
  'the truck carries the service (1000) less the NC (200), not the factura again'
);

select is(
  (select -coalesce(sum(amount_ars), 0) from pnl where bucket in ('operating_cost', 'unclassified')),
  800.00::numeric,
  'Gestión counts the factura net of the NC in the truck''s center'
);

select is(
  (select count(*)::int from vm where row_kind <> 'vehicle'),
  0,
  'nothing comes apart as unattributed'
);

select * from finish();
rollback;
