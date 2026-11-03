select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Recibos use the letter X (20261103210000): a new receipt's journal entry and
-- caja movement read "Recibo X…", and global search finds it by its X label
-- and by the legacy R label printed before the change. One transaction,
-- rolled back.

begin;

select plan(6);

-- The set_config above lasts one statement outside a transaction; this one
-- holds for the whole test.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000021e1', 'finance@letter-x.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000021e1', 'finance');

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000021c1', true, '20999999921', 'Cliente Letra X', 'responsable_inscripto');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000000021a1', 'Banco Letra X', 'bank', 'ARS');

create temp table new_receipt on commit drop as
  select public.create_receipt(
    'jouve_fiscal', 7, 98761, '00000000-0000-0000-0000-0000000021c1', current_date, 150, 'ARS', null,
    jsonb_build_array(jsonb_build_object(
      'account_id', '00000000-0000-0000-0000-0000000021a1', 'amount', 150, 'reference', null)),
    '[]'::jsonb, '[]'::jsonb) as id;

set constraints all immediate;

select is(
  (select je.description from public.journal_entries je
    where je.source_table = 'receipts' and je.source_id = (select id from new_receipt)),
  'Recibo X0007-00098761',
  'a new receipt posts its journal entry as Recibo X'
);

select is(
  (select t.description from public.transactions t
    where t.receipt_id = (select id from new_receipt)),
  'Recibo X0007-00098761',
  'its caja movement reads Recibo X'
);

refresh materialized view public.search_index;

select is(
  (select s.title from public.search_index s
    where s.entity_type = 'receipt' and s.entity_id = (select id::text from new_receipt)),
  'X0007-00098761',
  'the search index titles the receipt with X'
);

-- search_global filters by the caller's roles.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000021e1","role":"authenticated"}', true);

select ok(
  exists (select 1 from public.search_global('X0007-00098761', 50, array['receipt'])
           where entity_id = (select id::text from new_receipt)),
  'global search finds the receipt by its X number'
);

select ok(
  exists (select 1 from public.search_global('R0007-00098761', 50, array['receipt'])
           where entity_id = (select id::text from new_receipt)),
  'global search still finds it by the legacy R number'
);

select ok(
  not exists (select 1 from public.search_global('R0007-00098762', 50, array['receipt'])
               where entity_id = (select id::text from new_receipt)),
  'a different R number does not find it'
);

select * from finish();

rollback;
