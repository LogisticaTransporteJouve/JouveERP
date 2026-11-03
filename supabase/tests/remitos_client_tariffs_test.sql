-- Roadmap 4.1 + 4.2: a client's remito number is unique among its live cargas
-- (trimmed, case-insensitive; a cancelled carga frees it) and
-- shipment_remito_conflict finds the holder; client tariffs never overlap
-- for one client and concept, client_tariff_at returns the one in force, and
-- RLS keeps tariffs to the pricing roles. One transaction, rolled back.

begin;

select plan(20);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000041a1', 'finance@tariffs.test'),
  ('00000000-0000-0000-0000-0000000041a2', 'ops@tariffs.test'),
  ('00000000-0000-0000-0000-0000000041a3', 'warehouse@tariffs.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000041a1', 'finance'),
  ('00000000-0000-0000-0000-0000000041a2', 'operations'),
  ('00000000-0000-0000-0000-0000000041a3', 'warehouse');

insert into public.clients (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000041c1', '30741000011', 'Cliente Remitos', 'responsable_inscripto'),
  ('00000000-0000-0000-0000-0000000041c2', '30741000022', 'Otro Cliente', 'responsable_inscripto');

-- 1. Grants ------------------------------------------------------------------------

select ok(
  has_function_privilege('authenticated', 'public.shipment_remito_conflict(uuid, text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.shipment_remito_conflict(uuid, text, uuid)', 'execute'),
  'authenticated, not anon, runs shipment_remito_conflict'
);

select ok(
  has_function_privilege('authenticated', 'public.client_tariff_at(uuid, text, date)', 'execute')
  and not has_function_privilege('anon', 'public.client_tariff_at(uuid, text, date)', 'execute'),
  'authenticated, not anon, runs client_tariff_at'
);

select ok(
  not has_function_privilege('authenticated', 'public.guard_client_tariff_overlap()', 'execute'),
  'nobody calls the overlap guard directly'
);

-- 2. Remitos (as operations, who writes cargas) ------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000041a2","role":"authenticated"}', true);

insert into public.shipments (id, client_id, remito_number, origin, destination) values
  ('00000000-0000-0000-0000-0000000041d1', '00000000-0000-0000-0000-0000000041c1', '0001-00000123', 'Rosario', 'Córdoba');

select throws_ok(
  $$insert into public.shipments (client_id, remito_number)
    values ('00000000-0000-0000-0000-0000000041c1', ' 0001-00000123 ')$$,
  '23505',
  null,
  'the same remito for the same client is refused, with spaces around it'
);

select throws_ok(
  $$insert into public.shipments (client_id, remito_number)
    values ('00000000-0000-0000-0000-0000000041c1', 'a-1'),
           ('00000000-0000-0000-0000-0000000041c1', 'A-1')$$,
  '23505',
  null,
  'the comparison ignores case'
);

select lives_ok(
  $$insert into public.shipments (client_id, remito_number)
    values ('00000000-0000-0000-0000-0000000041c2', '0001-00000123')$$,
  'another client may use the same number'
);

select lives_ok(
  $$insert into public.shipments (client_id, remito_number)
    values ('00000000-0000-0000-0000-0000000041c1', null),
           ('00000000-0000-0000-0000-0000000041c1', null)$$,
  'cargas without a remito do not collide'
);

select results_eq(
  $$select id, origin from public.shipment_remito_conflict(
      '00000000-0000-0000-0000-0000000041c1', '0001-00000123 ', null)$$,
  $$values ('00000000-0000-0000-0000-0000000041d1'::uuid, 'Rosario'::text)$$,
  'shipment_remito_conflict finds the carga that holds the number'
);

select is_empty(
  $$select 1 from public.shipment_remito_conflict(
      '00000000-0000-0000-0000-0000000041c1', '0001-00000123',
      '00000000-0000-0000-0000-0000000041d1')$$,
  'the carga being edited is not its own conflict'
);

update public.shipments set status = 'cancelled'
 where id = '00000000-0000-0000-0000-0000000041d1';

select is_empty(
  $$select 1 from public.shipment_remito_conflict(
      '00000000-0000-0000-0000-0000000041c1', '0001-00000123', null)$$,
  'a cancelled carga holds no number'
);

insert into public.shipments (id, client_id, remito_number) values
  ('00000000-0000-0000-0000-0000000041d2', '00000000-0000-0000-0000-0000000041c1', '0001-00000123');

select throws_ok(
  $$update public.shipments set status = 'not_started'
     where id = '00000000-0000-0000-0000-0000000041d1'$$,
  '23505',
  null,
  'taking the cancelled carga back fails while another carga holds its number'
);

reset role;

-- 3. Client tariffs (as finance) ----------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000041a1","role":"authenticated"}', true);

insert into public.client_tariffs (id, client_id, concept, unit, price, valid_from, valid_to) values
  ('00000000-0000-0000-0000-0000000041e1', '00000000-0000-0000-0000-0000000041c1',
   'storage', 'pallet_month', 3000, '2026-01-01', '2026-06-30');

select throws_ok(
  $$insert into public.client_tariffs (client_id, concept, unit, price, valid_from)
    values ('00000000-0000-0000-0000-0000000041c1', 'storage', 'pallet_day', 100, '2026-06-30')$$,
  '23P01',
  'Ya hay una tarifa de ese concepto vigente del 01/01/2026 al 30/06/2026: cerrala antes o elegí otras fechas.',
  'an overlapping tariff of the same client and concept is refused'
);

select lives_ok(
  $$insert into public.client_tariffs (id, client_id, concept, unit, price, currency, valid_from)
    values ('00000000-0000-0000-0000-0000000041e2', '00000000-0000-0000-0000-0000000041c1',
            'storage', 'pallet_day', 5, 'USD', '2026-07-01')$$,
  'the next day starts a new tariff'
);

select lives_ok(
  $$insert into public.client_tariffs (client_id, concept, unit, price, valid_from)
    values ('00000000-0000-0000-0000-0000000041c1', 'handling_in', 'pallet', 500, '2026-03-01'),
           ('00000000-0000-0000-0000-0000000041c2', 'storage', 'pallet_day', 90, '2026-03-01')$$,
  'another concept or another client may overlap'
);

select throws_ok(
  $$insert into public.client_tariffs (client_id, concept, unit, price, valid_from)
    values ('00000000-0000-0000-0000-0000000041c1', 'handling_out', 'pallet_month', 1, '2026-01-01')$$,
  '23514',
  null,
  'a unit the concept does not take is refused'
);

select results_eq(
  $$select id from public.client_tariff_at('00000000-0000-0000-0000-0000000041c1', 'storage', '2026-06-30')$$,
  $$values ('00000000-0000-0000-0000-0000000041e1'::uuid)$$,
  'client_tariff_at returns the tariff in force on its last day'
);

select results_eq(
  $$select id, currency from public.client_tariff_at('00000000-0000-0000-0000-0000000041c1', 'storage', '2027-01-01')$$,
  $$values ('00000000-0000-0000-0000-0000000041e2'::uuid, 'USD'::text)$$,
  'an open-ended tariff stays in force'
);

reset role;

-- Moving a tariff into another's range is an UPDATE: asserted as owner,
-- since RLS would filter the row silently for a role it hides it from.
select throws_ok(
  $$update public.client_tariffs set valid_from = '2026-06-01'
     where id = '00000000-0000-0000-0000-0000000041e2'$$,
  '23P01',
  null,
  'an edit that makes two tariffs overlap is refused'
);

-- 4. RLS ---------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000041a3","role":"authenticated"}', true);

select is_empty(
  $$select 1 from public.client_tariffs$$,
  'warehouse sees no client tariff'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000041a2","role":"authenticated"}', true);

select throws_ok(
  $$insert into public.client_tariffs (client_id, concept, unit, price, valid_from)
    values ('00000000-0000-0000-0000-0000000041c2', 'handling_in', 'pallet', 1, '2030-01-01')$$,
  '42501',
  null,
  'operations cannot write a tariff'
);

reset role;

select * from finish(true);

rollback;
