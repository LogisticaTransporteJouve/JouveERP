-- Audit w13 S2 F1 (20261105090000): the liquidación and rendición guards on
-- cargas and trips bind operations, who cannot read the settlement tables.
-- Every edit below runs as an operations user (role authenticated, its sub),
-- never as the superuser that bypasses RLS. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000013a0f1', 'ops@guards-w13.test'),
  ('00000000-0000-0000-0000-00000013a0f2', 'finance@guards-w13.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-00000013a0f1', 'operations'),
  ('00000000-0000-0000-0000-00000013a0f2', 'finance');

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000013a0c1', false, null, 'Cliente guardas w13', null),
  ('00000000-0000-0000-0000-00000013a0c2', false, null, 'Otro cliente guardas w13', null);

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000013a0b1', 'Caja guardas w13', 'cash', 'ARS');

insert into public.drivers (id, full_name) values
  ('00000000-0000-0000-0000-00000013a0e1', 'Chofer guardas uno'),
  ('00000000-0000-0000-0000-00000013a0e2', 'Chofer guardas dos');
insert into public.trips (id, trip_date, driver_id) values
  ('00000000-0000-0000-0000-00000013a0a1', '2026-11-01', '00000000-0000-0000-0000-00000013a0e1');

-- k1 goes into a confirmed liquidación; k2 (cash on delivery, on the trip)
-- into a rendición; k3 into nothing.
insert into public.shipments
  (id, client_id, trip_id, remito_number, status, delivery_date, freight_amount, cod_amount)
values
  ('00000000-0000-0000-0000-00000013a0d1', '00000000-0000-0000-0000-00000013a0c1', null,
   'GW-1', 'delivered', '2026-11-01', 100, null),
  ('00000000-0000-0000-0000-00000013a0d2', '00000000-0000-0000-0000-00000013a0c1',
   '00000000-0000-0000-0000-00000013a0a1', 'GW-2', 'delivered', '2026-11-01', null, 500),
  ('00000000-0000-0000-0000-00000013a0d3', '00000000-0000-0000-0000-00000013a0c1', null,
   'GW-3', 'delivered', '2026-11-01', 100, null);

insert into public.freight_settlements (id, client_id, period_start, period_end, total) values
  ('00000000-0000-0000-0000-00000013a051', '00000000-0000-0000-0000-00000013a0c1',
   '1997-01-01', '1997-01-31', 100);
insert into public.freight_settlement_items (settlement_id, shipment_id, amount, price_source) values
  ('00000000-0000-0000-0000-00000013a051', '00000000-0000-0000-0000-00000013a0d1', 100, 'freight');
update public.freight_settlements set status = 'confirmed', channel = 'internal'
 where id = '00000000-0000-0000-0000-00000013a051';

select public.save_driver_settlement(
  '00000000-0000-0000-0000-00000013a0e1', '2026-11-03', 'guardas w13',
  jsonb_build_array(jsonb_build_object(
    'shipment_id', '00000000-0000-0000-0000-00000013a0d2',
    'lines', jsonb_build_array(jsonb_build_object(
      'account_id', '00000000-0000-0000-0000-00000013a0b1', 'amount', 500)))),
  '00000000-0000-0000-0000-00000013a0f2');

select ok(
  (select bool_and(p.prosecdef)
     from pg_proc p
    where p.oid in ('public.guard_shipment_freight_settlement()'::regprocedure,
                    'public.guard_shipment_driver_settlement()'::regprocedure,
                    'public.guard_trip_driver_settlement()'::regprocedure))
  and not has_function_privilege('authenticated', 'public.guard_shipment_freight_settlement()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_shipment_driver_settlement()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_trip_driver_settlement()', 'execute')
  and not has_function_privilege('anon', 'public.guard_trip_driver_settlement()', 'execute'),
  'the three guards are security definer and nobody calls them directly'
);

-- As operations -------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000013a0f1","role":"authenticated"}', true);

select is_empty(
  $$select 1 from public.freight_settlement_items
    union all select 1 from public.driver_settlement_items$$,
  'operations reads no settlement (what made the invoker guards no-ops)'
);

select throws_like(
  $$update public.shipments set client_id = '00000000-0000-0000-0000-00000013a0c2'
     where id = '00000000-0000-0000-0000-00000013a0d1'$$,
  '%cancelá la liquidación para cambiar su cliente o su estado.',
  'operations cannot move a carga of a live liquidación to another client'
);

select throws_like(
  $$update public.shipments set status = 'cancelled'
     where id = '00000000-0000-0000-0000-00000013a0d1'$$,
  '%cancelá la liquidación para cambiar su cliente o su estado.',
  'operations cannot cancel a carga of a live liquidación'
);

select throws_like(
  $$update public.shipments set freight_amount = 1
     where id = '00000000-0000-0000-0000-00000013a0d1'$$,
  '%ya confirmada: su flete no cambia.',
  'operations cannot change the flete of a carga in a confirmed liquidación'
);

select throws_like(
  $$delete from public.shipments where id = '00000000-0000-0000-0000-00000013a0d1'$$,
  '%cancelá la liquidación antes de borrarla.',
  'operations cannot delete a carga of a live liquidación'
);

select throws_like(
  $$update public.shipments set cod_amount = 50
     where id = '00000000-0000-0000-0000-00000013a0d2'$$,
  '%cancelá la rendición para cambiar su cobranza, cliente, viaje o estado.',
  'operations cannot change the cobranza of a carga in a rendición'
);

select throws_like(
  $$update public.trips set driver_id = '00000000-0000-0000-0000-00000013a0e2'
     where id = '00000000-0000-0000-0000-00000013a0a1'$$,
  'El viaje tiene cargas en una rendición%',
  'operations cannot change the driver of a trip with a carga in a rendición'
);

-- A carga in no settlement is edited as before.
update public.shipments
   set client_id = '00000000-0000-0000-0000-00000013a0c2', freight_amount = 120
 where id = '00000000-0000-0000-0000-00000013a0d3';

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select results_eq(
  $$select client_id, freight_amount from public.shipments
     where id = '00000000-0000-0000-0000-00000013a0d3'$$,
  $$values ('00000000-0000-0000-0000-00000013a0c2'::uuid, 120::numeric)$$,
  'operations still edits a carga that is in no liquidación or rendición'
);

select results_eq(
  $$select client_id, status, freight_amount from public.shipments
     where id = '00000000-0000-0000-0000-00000013a0d1'$$,
  $$values ('00000000-0000-0000-0000-00000013a0c1'::uuid, 'delivered'::text, 100::numeric)$$,
  'the carga of the liquidación kept its client, status and flete'
);

select * from finish();

rollback;
