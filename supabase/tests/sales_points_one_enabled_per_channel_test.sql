-- 20261106110002: a channel has at most one enabled point of sale. One
-- transaction, rolled back.

begin;

select plan(4);

insert into public.sales_points (numero, channel_id, nickname, is_enabled) values
  (9611, null, 'POS libre 1', false),
  (9612, null, 'POS libre 2', false);

-- Whatever the seed enabled on jouve_internal (9001) stays; take the channel
-- free of enabled POS first, inside this rolled-back transaction.
update public.sales_points set is_enabled = false where channel_id = 'jouve_internal';

select lives_ok(
  $$update public.sales_points set channel_id = 'jouve_internal', is_enabled = true
     where numero = 9611$$,
  'a channel enables its one POS'
);

select throws_ok(
  $$update public.sales_points set channel_id = 'jouve_internal', is_enabled = true
     where numero = 9612$$,
  '23505',
  null,
  'a second enabled POS on the same channel is refused'
);

select lives_ok(
  $$update public.sales_points set channel_id = 'jouve_internal', is_enabled = false
     where numero = 9612$$,
  'a second POS can still sit on the channel disabled'
);

select is(
  (select count(*)::int from public.sales_points
    where channel_id = 'jouve_internal' and is_enabled),
  1,
  'the channel keeps exactly one enabled POS'
);

select * from finish();
rollback;
