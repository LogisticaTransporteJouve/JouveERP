-- Unificar tarifas: a client's single, open-ended storage_tariffs row moves
-- to its tarifario with the same prices and validity; any other row stays.
-- The billing equivalence of the moved rows is checked in
-- features/storage-billing/lib/billing-migrated-tariffs.test.ts (billing
-- is computed in the app); this checks the data. One transaction, rolled back.

begin;

select plan(9);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000004a0c1', false, null, 'Migra Uno', null),
  ('00000000-0000-0000-0000-00000004a0c2', false, null, 'Migra Dos (dos filas)', null),
  ('00000000-0000-0000-0000-00000004a0c3', false, null, 'Migra Tres (con fin)', null),
  ('00000000-0000-0000-0000-00000004a0c4', false, null, 'Migra Cuatro (ya tiene tarifario)', null);

insert into public.storage_tariffs
  (id, client_id, rate_per_pallet, period, handling_in, handling_out, valid_from, valid_to)
values
  ('00000000-0000-0000-0000-00000004a0e1', '00000000-0000-0000-0000-00000004a0c1', 3000, 'monthly', 500, 0, '2026-01-01', null),
  ('00000000-0000-0000-0000-00000004a0e2', '00000000-0000-0000-0000-00000004a0c2', 3000, 'monthly', 0, 0, '2026-01-01', '2026-05-31'),
  ('00000000-0000-0000-0000-00000004a0e3', '00000000-0000-0000-0000-00000004a0c2', 3500, 'monthly', 0, 0, '2026-06-01', null),
  ('00000000-0000-0000-0000-00000004a0e4', '00000000-0000-0000-0000-00000004a0c3', 100, 'daily', 0, 0, '2026-01-01', '2027-12-31'),
  ('00000000-0000-0000-0000-00000004a0e5', '00000000-0000-0000-0000-00000004a0c4', 3000, 'monthly', 0, 0, '2026-01-01', null);
insert into public.client_tariffs (client_id, concept, unit, price, valid_from) values
  ('00000000-0000-0000-0000-00000004a0c4', 'storage', 'pallet_day', 90, '2026-01-01');

select ok(
  has_function_privilege('service_role', 'public.migrate_client_storage_tariffs()', 'execute')
  and not has_function_privilege('authenticated', 'public.migrate_client_storage_tariffs()', 'execute'),
  'only the service role migrates'
);

select is(public.migrate_client_storage_tariffs(), 1, 'one row qualifies');

select results_eq(
  $$select concept, unit, price, currency, valid_from, valid_to
      from public.client_tariffs
     where client_id = '00000000-0000-0000-0000-00000004a0c1'
     order by concept$$,
  $$values ('handling_in'::text, 'pallet'::text, 500::numeric, 'ARS'::text, '2026-01-01'::date, null::date),
           ('storage'::text, 'pallet_month'::text, 3000::numeric, 'ARS'::text, '2026-01-01'::date, null::date)$$,
  'the tarifario gets the same prices and validity (a zero descarga is not copied)'
);
select ok(
  (select migrated_to_client_tariffs_at is not null and is_active
     from public.storage_tariffs where id = '00000000-0000-0000-0000-00000004a0e1'),
  'the old row stays, active, marked as migrated'
);
select is(
  (select count(*)::int from public.client_tariffs
    where client_id in ('00000000-0000-0000-0000-00000004a0c2', '00000000-0000-0000-0000-00000004a0c3')),
  0, 'a client with two rows, or a row with an end, is left as it is'
);
select is(
  (select count(*)::int from public.client_tariffs
    where client_id = '00000000-0000-0000-0000-00000004a0c4'),
  1, 'a client that already has a tarifario is left as it is'
);

select is(public.migrate_client_storage_tariffs(), 0, 'running it again migrates nothing');

select throws_ok(
  $$update public.storage_tariffs set rate_per_pallet = 4000
     where id = '00000000-0000-0000-0000-00000004a0e1'$$,
  '55006', 'Esta tarifa pasó al tarifario del cliente: cambiala en el detalle del cliente › Tarifario.',
  'a migrated row keeps its prices'
);
select lives_ok(
  $$update public.storage_tariffs set notes = 'ok'
     where id = '00000000-0000-0000-0000-00000004a0e1'$$,
  'its notes still change'
);

select * from finish();
rollback;
