-- Flota › Tarifas (20261106200000): a version's lines are replaced in order,
-- an increase copies each list's latest version with its prices raised and
-- rounded (percentages kept), and refuses a date that is not after it.
-- One transaction, rolled back.

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(9);

insert into public.freight_tariff_lists (id, name) values
  ('00000000-0000-0000-0000-0000000f1a01', 'General'),
  ('00000000-0000-0000-0000-0000000f1a02', 'Clientes con %');
insert into public.freight_tariff_versions (id, list_id, label, valid_from) values
  ('00000000-0000-0000-0000-0000000f1b01', '00000000-0000-0000-0000-0000000f1a01', 'Noviembre/Diciembre 26', '2026-11-01'),
  ('00000000-0000-0000-0000-0000000f1b02', '00000000-0000-0000-0000-0000000f1a02', 'Noviembre/Diciembre 26', '2026-11-01');

select is(
  public.replace_freight_tariff_lines(
    '00000000-0000-0000-0000-0000000f1b01',
    '[{"section": "Bultos", "concept": "1", "price": 35330},
      {"section": "1 pallet", "concept": "0 a 199 kg", "price": 107160},
      {"section": "Retiros", "concept": "Bultos", "note": "Tarifa + $ 62.600"}]'::jsonb),
  3,
  'a version takes its lines'
);

select is(
  (select array_agg(concept order by sort_order) from public.freight_tariff_lines
    where version_id = '00000000-0000-0000-0000-0000000f1b01'),
  array['1', '0 a 199 kg', 'Bultos'],
  'in the order sent'
);

select public.replace_freight_tariff_lines(
  '00000000-0000-0000-0000-0000000f1b02',
  '[{"concept": "Perelli", "percent": 5}]'::jsonb);

create temp table t_new on commit drop as
  select public.apply_freight_tariff_increase(
    array['00000000-0000-0000-0000-0000000f1a01', '00000000-0000-0000-0000-0000000f1a02']::uuid[],
    7.5, 'Enero/Febrero 27', '2027-01-01', 10, null) as id;

select is((select count(*)::int from t_new), 2, 'one new version per list');

select is(
  (select price from public.freight_tariff_lines l
     join public.freight_tariff_versions v on v.id = l.version_id
    where v.list_id = '00000000-0000-0000-0000-0000000f1a01'
      and v.valid_from = '2027-01-01' and l.concept = '1'),
  37980::numeric,
  'a price goes up 7,5% and rounds to $10 (35.330 → 37.979,75 → 37.980)'
);

select is(
  (select note from public.freight_tariff_lines l
     join public.freight_tariff_versions v on v.id = l.version_id
    where v.list_id = '00000000-0000-0000-0000-0000000f1a01'
      and v.valid_from = '2027-01-01' and l.concept = 'Bultos'),
  'Tarifa + $ 62.600',
  'a note is copied as it is'
);

select is(
  (select percent from public.freight_tariff_lines l
     join public.freight_tariff_versions v on v.id = l.version_id
    where v.list_id = '00000000-0000-0000-0000-0000000f1a02'
      and v.valid_from = '2027-01-01'),
  5::numeric,
  'a percentage does not go up'
);

select is(
  (select increase_pct from public.freight_tariff_versions
    where list_id = '00000000-0000-0000-0000-0000000f1a01' and valid_from = '2027-01-01'),
  7.5::numeric,
  'the new version records the increase'
);

select throws_ok(
  $$select public.apply_freight_tariff_increase(
      array['00000000-0000-0000-0000-0000000f1a01']::uuid[], 5, 'Otra', '2026-12-01', 1, null)$$,
  '23514', null,
  'an increase that starts before the latest prices is refused'
);

select throws_ok(
  $$select public.apply_freight_tariff_increase(
      array['00000000-0000-0000-0000-0000000f1a01']::uuid[], 5, 'Otra', '2027-03-01', 7, null)$$,
  '22023', null,
  'the rounding is 1, 10 or 100'
);

select * from finish();
rollback;
