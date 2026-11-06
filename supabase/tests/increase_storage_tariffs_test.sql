-- increase_storage_tariffs (20261106111001): the raised rows and the close of
-- the old ones in one transaction; only tariffs in force that started before
-- the date are raised; a second run for the same date finds nothing left.
-- One transaction, rolled back.

begin;

select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000006a1', 'finance@tariff-increase.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000006a1', 'finance');

-- Only these rows count: the function reads every tariff.
delete from public.storage_tariffs;

insert into public.storage_tariffs
  (id, rate_per_pallet, handling_in, handling_out, period, valid_from, valid_to, is_active)
values
  -- raised
  ('00000000-0000-0000-0000-0000000006b1', 1500.50, 100, 0, 'monthly', '2026-01-01', null, true),
  -- starts on the date: skipped
  ('00000000-0000-0000-0000-0000000006b2', 2000, 0, 0, 'monthly', '2026-11-01', null, true),
  -- ended before the date: untouched
  ('00000000-0000-0000-0000-0000000006b3', 900, 0, 0, 'daily', '2025-01-01', '2026-10-31', true),
  -- inactive: untouched
  ('00000000-0000-0000-0000-0000000006b4', 700, 0, 0, 'daily', '2025-01-01', null, false);

select ok(
  has_function_privilege('authenticated', 'public.increase_storage_tariffs(numeric, date)', 'execute')
  and not has_function_privilege('anon', 'public.increase_storage_tariffs(numeric, date)', 'execute'),
  'authenticated runs increase_storage_tariffs; anon does not'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000006a1","role":"authenticated"}', true);

select results_eq(
  $$select updated, skipped from public.increase_storage_tariffs(10, '2026-11-01')$$,
  $$values (1, 1)$$,
  'one tariff raised, the one starting that day skipped'
);

select results_eq(
  $$select rate_per_pallet, handling_in, handling_out, period, valid_to, notes, created_by
      from public.storage_tariffs
     where valid_from = '2026-11-01' and id <> '00000000-0000-0000-0000-0000000006b2'$$,
  $$values (1650.55::numeric, 110.00::numeric, 0.00::numeric, 'monthly'::text, null::date,
            'Aumento 10% s/ $1.500,5'::text, '00000000-0000-0000-0000-0000000006a1'::uuid)$$,
  'the new row: × 1.10 rounded to cents, open-ended, noted and owned by the caller'
);

select is(
  (select valid_to from public.storage_tariffs where id = '00000000-0000-0000-0000-0000000006b1'),
  '2026-10-31'::date,
  'the raised tariff closes the day before'
);

select results_eq(
  $$select id, valid_to from public.storage_tariffs
     where id in ('00000000-0000-0000-0000-0000000006b2', '00000000-0000-0000-0000-0000000006b3',
                  '00000000-0000-0000-0000-0000000006b4')
     order by id$$,
  $$values ('00000000-0000-0000-0000-0000000006b2'::uuid, null::date),
           ('00000000-0000-0000-0000-0000000006b3'::uuid, '2026-10-31'::date),
           ('00000000-0000-0000-0000-0000000006b4'::uuid, null::date)$$,
  'skipped, ended and inactive tariffs are left as they were'
);

select throws_ok(
  $$select * from public.increase_storage_tariffs(10, '2026-11-01')$$,
  'P0002',
  'No hay tarifas vigentes anteriores a esa fecha para aumentar.',
  'a second increase for the same date finds nothing left to raise'
);

select is(
  (select count(*)::int from public.storage_tariffs),
  5,
  'the refused run inserted nothing'
);

-- A raise that breaks a row's check fails whole: nothing new, nothing closed.
select throws_ok(
  $$select * from public.increase_storage_tariffs(-99.9999, '2026-12-01')$$,
  '23514',
  null,
  'a decrease that prices a tariff at 0 is refused'
);

select results_eq(
  $$select count(*)::int, count(*) filter (where valid_to = '2026-11-30')::int
      from public.storage_tariffs$$,
  $$values (5, 0)$$,
  'and leaves every tariff as it was'
);

select * from finish();
rollback;
