-- v_client_aging_by_scope / v_supplier_aging_by_scope: one row per
-- counterparty and scope; an inactive fiscal channel still reads as fiscal;
-- authenticated reads them under RLS, anon does not. One transaction, rolled
-- back.

begin;

select plan(8);

insert into public.invoicing_channels (id, business_unit_id, name, is_fiscal, is_active)
values ('test_old_fiscal', 'dz_sons', 'Fiscal viejo', true, true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f2', 'finance@aging-scope.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000000f2', 'finance');

-- The documents' journal entries are created as this finance user.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);

insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000c201', '30999999995', 'Proveedor Alcance', 'responsable_inscripto');

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, imp_neto, imp_iva, imp_total, status)
values
  ('00000000-0000-0000-0000-0000000006a1', 'test_old_fiscal', '00000000-0000-0000-0000-00000000c201',
   'factura', 'A', 1, 41, current_date, 100, 21, 121, 'received'),
  ('00000000-0000-0000-0000-0000000006a2', 'jouve_internal', '00000000-0000-0000-0000-00000000c201',
   'factura', null, 1, 42, current_date, 50, 0, 50, 'received');

-- The fiscal channel is retired after its document: history keeps its scope.
update public.invoicing_channels set is_active = false where id = 'test_old_fiscal';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);

select is(
  (select ars_total_open from public.v_supplier_aging_by_scope
    where supplier_id = '00000000-0000-0000-0000-00000000c201' and channel_is_fiscal),
  121::numeric,
  'fiscal scope includes the inactive fiscal channel'
);
select is(
  (select ars_total_open from public.v_supplier_aging_by_scope
    where supplier_id = '00000000-0000-0000-0000-00000000c201' and not channel_is_fiscal),
  50::numeric,
  'internal scope holds only the internal document'
);
select is(
  (select count(*)::int from public.v_supplier_aging_by_scope
    where supplier_id = '00000000-0000-0000-0000-00000000c201' and channel_is_fiscal),
  1,
  'one row per supplier within a scope'
);
select is(
  (select ars_total_open from public.v_supplier_aging
    where supplier_id = '00000000-0000-0000-0000-00000000c201'),
  171::numeric,
  'Todos still reads every channel from v_supplier_aging'
);

reset role;

select ok(
  has_table_privilege('authenticated', 'public.v_client_aging_by_scope', 'select')
    and has_table_privilege('authenticated', 'public.v_supplier_aging_by_scope', 'select'),
  'authenticated can read both views'
);
select ok(
  not has_table_privilege('anon', 'public.v_client_aging_by_scope', 'select')
    and not has_table_privilege('anon', 'public.v_supplier_aging_by_scope', 'select'),
  'anon cannot read either view'
);
select ok(
  (select 'security_invoker=on' = any (reloptions) from pg_class
    where oid = 'public.v_client_aging_by_scope'::regclass),
  'v_client_aging_by_scope runs as the invoker'
);
select ok(
  (select 'security_invoker=on' = any (reloptions) from pg_class
    where oid = 'public.v_supplier_aging_by_scope'::regclass),
  'v_supplier_aging_by_scope runs as the invoker'
);

select * from finish();
rollback;
