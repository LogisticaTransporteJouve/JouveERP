-- 20261104120300_deactivate_flota_dz: DZ Instalaciones was retired, so its
-- cost center stays on the records that use it but is no longer offered.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select plan(2);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select is(
  (select count(*)::int from public.cost_centers where code = 'FLOTA_DZ' and is_active),
  0,
  'FLOTA_DZ is not an active cost center'
);

select is(
  (select count(*)::int from public.cost_centers
    where code in ('FLOTA_JOUVE', 'ADMIN') and is_active),
  2,
  'the Jouve centers stay active'
);

select * from finish();
rollback;
