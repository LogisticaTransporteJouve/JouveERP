-- One enabled point of sale per channel (sales_points_one_enabled_per_channel)
-- and POS 9001 gone. One transaction, rolled back.

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(4);

select is(
  (select count(*) from public.sales_points where numero = 9001),
  0::bigint,
  'POS 9001 is gone'
);

insert into public.sales_points (numero, channel_id, nickname, is_enabled, last_synced_at)
values (97001, null, 'Otro interno', false, null);

select throws_ok(
  $$update public.sales_points set channel_id = 'jouve_internal', is_enabled = true where numero = 97001$$,
  '23505',
  null,
  'a second enabled POS on a channel is refused'
);

select lives_ok(
  $$update public.sales_points set channel_id = 'jouve_internal', is_enabled = false where numero = 97001$$,
  'a disabled one can sit on the channel'
);

select lives_ok(
  $$update public.sales_points set is_enabled = false where channel_id = 'jouve_internal' and numero <> 97001;
    update public.sales_points set is_enabled = true where numero = 97001$$,
  'the channel can switch its POS'
);

select * from finish();
rollback;
