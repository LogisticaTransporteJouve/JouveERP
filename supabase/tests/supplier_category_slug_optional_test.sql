-- 20261105230000: a supplier category no longer needs a slug: two created
-- without one each get a distinct generated one. One transaction, rolled back.

begin;

select plan(2);

select lives_ok(
  $$insert into public.supplier_categories (id, name) values
      ('00000000-0000-0000-0000-00000000c501', 'Sin slug uno'),
      ('00000000-0000-0000-0000-00000000c502', 'Sin slug dos')$$,
  'categories insert without a slug'
);

select is(
  (select count(*)::int from public.supplier_categories
    where id in ('00000000-0000-0000-0000-00000000c501',
                 '00000000-0000-0000-0000-00000000c502')
      and slug ~ '^c_[0-9a-f]{32}$'),
  2,
  'both categories get a generated slug'
);

select * from finish();
rollback;
