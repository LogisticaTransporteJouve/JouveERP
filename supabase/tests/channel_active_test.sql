-- guard_channel_active: nothing is created on, or moved to, an inactive
-- channel; rows already there keep working. dz_open_items is internal.
-- One transaction, rolled back.

begin;

select plan(9);

insert into public.invoicing_channels (id, business_unit_id, division, name, is_fiscal, is_active)
values ('test_closed', 'dz_sons', 'jouve', 'Canal cerrado', false, true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'finance@channel-active.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000000f1', 'finance');

insert into public.suppliers (id, cuit, legal_name, iva_condition, default_channel_id) values
  ('00000000-0000-0000-0000-00000000b101', '30555555556', 'Proveedor Viejo', 'responsable_inscripto', 'test_closed'),
  ('00000000-0000-0000-0000-00000000b102', '30666666667', 'Proveedor Nuevo', 'responsable_inscripto', 'jouve_internal');

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_neto, imp_iva, imp_total, status)
values
  ('00000000-0000-0000-0000-0000000005a1', 'test_closed', '00000000-0000-0000-0000-00000000b101',
   'factura', 1, 30, current_date, 100, 0, 100, 'received');

update public.invoicing_channels set is_active = false where id = 'test_closed';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);

select throws_ok(
  $$insert into public.suppliers (cuit, legal_name, iva_condition, default_channel_id)
    values ('30777777778', 'Otro', 'responsable_inscripto', 'test_closed')$$,
  '23514',
  'El canal Canal cerrado está inactivo: no se pueden crear ni mover registros a ese canal',
  'an insert on an inactive channel is refused'
);

select throws_ok(
  $$update public.suppliers set default_channel_id = 'test_closed'
     where id = '00000000-0000-0000-0000-00000000b102'$$,
  '23514',
  null,
  'an update that moves a row to an inactive channel is refused'
);

select lives_ok(
  $$update public.suppliers set legal_name = 'Proveedor Viejo SA'
     where id = '00000000-0000-0000-0000-00000000b101'$$,
  'a row already on an inactive channel can still be edited'
);

select lives_ok(
  $$update public.suppliers set default_channel_id = null
     where id = '00000000-0000-0000-0000-00000000b101'$$,
  'a row can leave an inactive channel'
);

select lives_ok(
  $$insert into public.suppliers (cuit, legal_name, iva_condition, default_channel_id)
    values ('30888888889', 'Sin canal', 'responsable_inscripto', null)$$,
  'a NULL channel passes'
);

reset role;

select lives_ok(
  $$update public.purchase_invoices set notes = 'corregida'
     where id = '00000000-0000-0000-0000-0000000005a1'$$,
  'a document of an inactive channel can still be corrected'
);

select throws_ok(
  $$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_total, status)
    values ('test_closed', '00000000-0000-0000-0000-00000000b101', 'factura', 1, 31, current_date, 10, 'received')$$,
  '23514',
  null,
  'no new document on an inactive channel, even as postgres'
);

select ok(
  not has_function_privilege('authenticated', 'public.dz_open_items()', 'execute'),
  'authenticated cannot run dz_open_items'
);

select ok(
  not has_function_privilege('authenticated', 'public.guard_channel_active()', 'execute'),
  'authenticated cannot run guard_channel_active'
);

select * from finish();

rollback;
