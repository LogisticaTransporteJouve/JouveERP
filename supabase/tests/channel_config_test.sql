-- invoicing_channels / sales_points: configuration cannot rewrite history.
-- Run as an admin (the role the RLS lets update both tables). One
-- transaction, rolled back.

begin;

select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f4', 'admin@channel-config.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000000f4', 'admin');

insert into public.invoicing_channels (id, business_unit_id, division, name, is_fiscal, is_active) values
  ('test_used', 'dz_sons', 'jouve', 'Canal usado', false, true),
  ('test_empty', 'dz_sons', 'jouve', 'Canal vacío', false, true),
  ('test_fiscal', 'dz_sons', 'jouve', 'Canal fiscal', true, true);

insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000b201', '30555555556', 'Proveedor Config', 'responsable_inscripto');

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_neto, imp_iva, imp_total, status)
values
  ('00000000-0000-0000-0000-0000000005b1', 'test_used', '00000000-0000-0000-0000-00000000b201',
   'factura', 1, 40, current_date, 100, 0, 100, 'received');

insert into public.sales_points (numero, channel_id, is_enabled, last_synced_at) values
  (99001, 'test_used', true, null),
  (99002, 'test_empty', true, null),
  (99003, 'test_fiscal', true, now());

insert into public.payment_orders (channel_id, punto_venta, numero, supplier_id, payment_date, total_amount, currency)
values ('test_used', 99001, 1, '00000000-0000-0000-0000-00000000b201', current_date, 10, 'ARS');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f4","role":"authenticated"}', true);

select throws_ok(
  $$update public.invoicing_channels set is_fiscal = true where id = 'test_used'$$,
  '23514',
  'El canal Canal usado ya tiene documentos: no se puede cambiar si es fiscal ni su división',
  'a channel with documents cannot become fiscal'
);

select throws_ok(
  $$update public.invoicing_channels set division = 'dz' where id = 'test_used'$$,
  '23514',
  null,
  'a channel with documents cannot change division'
);

select lives_ok(
  $$update public.invoicing_channels set name = 'Canal usado (renombrado)', is_active = false where id = 'test_used'$$,
  'a channel with documents can be renamed and deactivated'
);

select lives_ok(
  $$update public.invoicing_channels set is_active = true where id = 'test_used'$$,
  'and reactivated'
);

select lives_ok(
  $$update public.invoicing_channels set is_fiscal = true where id = 'test_empty'$$,
  'a channel without documents can still change'
);

select throws_ok(
  $$update public.sales_points set channel_id = 'test_empty' where numero = 99001$$,
  '23514',
  'El POS 99001 ya numeró comprobantes en su canal: no se lo puede cambiar de canal',
  'a POS that numbered documents cannot change channel'
);

select throws_ok(
  $$update public.sales_points set channel_id = 'jouve_internal' where numero = 99003$$,
  '23514',
  'El POS 99003 está sincronizado con AFIP: solo puede ir a un canal fiscal',
  'a POS synced with AFIP cannot move to a non-fiscal channel'
);

select lives_ok(
  $$update public.sales_points set nickname = 'Mostrador', is_enabled = false where numero = 99001$$,
  'a POS can be renamed and disabled'
);

select lives_ok(
  $$update public.sales_points set last_synced_at = now(), last_known_blocked = false where numero = 99002$$,
  'an internal POS can be synced'
);

select * from finish();

rollback;
