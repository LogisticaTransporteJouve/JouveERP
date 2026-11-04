-- ARCA received vouchers tray (20261104104001): who reads it, who can write
-- it, how a voucher links to a purchase already loaded (on ingest and through
-- the trigger) and the unsupported ⇔ no kind rule. One transaction, rolled
-- back.

begin;

select plan(14);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000ac001', 'finance@arca.test'),
  ('00000000-0000-0000-0000-0000000ac002', 'fiscal@arca.test'),
  ('00000000-0000-0000-0000-0000000ac003', 'ops@arca.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000ac001', 'finance'),
  ('00000000-0000-0000-0000-0000000ac002', 'fiscal_reader'),
  ('00000000-0000-0000-0000-0000000ac003', 'operations');

insert into public.suppliers (id, cuit, legal_name, iva_condition, is_fiscal) values
  ('00000000-0000-0000-0000-0000000ac101', '30755555551', 'Proveedor Bandeja SA', 'responsable_inscripto', true);

-- A received fiscal purchase A 0003-00000010, a cancelled one (11), one
-- without letter (12, historical: the letter guard is off for this insert);
-- nothing loaded for 13. An internal purchase cannot share the CUIT: its
-- supplier is an internal one.
alter table public.purchase_invoices disable trigger purchase_invoices_fiscal_letter;
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, moneda, cotizacion, status, cancelled_at)
values
  ('00000000-0000-0000-0000-0000000ac201', 'jouve_fiscal', '00000000-0000-0000-0000-0000000ac101',
   'factura', 'A', 3, 10, '2026-09-01', 100, 21, 121, 'PES', 1, 'received', null),
  ('00000000-0000-0000-0000-0000000ac202', 'jouve_fiscal', '00000000-0000-0000-0000-0000000ac101',
   'factura', 'A', 3, 11, '2026-09-01', 100, 21, 121, 'PES', 1, 'cancelled', now()),
  ('00000000-0000-0000-0000-0000000ac203', 'jouve_fiscal', '00000000-0000-0000-0000-0000000ac101',
   'factura', null, 3, 12, '2026-09-01', 100, 21, 121, 'PES', 1, 'received', null);
alter table public.purchase_invoices enable trigger purchase_invoices_fiscal_letter;

insert into public.arca_received_vouchers
  (id, origin, issuer_cuit, issuer_name, cbte_tipo, kind, letter, punto_venta, numero, fecha,
   imp_neto_gravado, imp_iva, imp_total, status)
values
  ('00000000-0000-0000-0000-0000000ac301', 'upload', '30755555551', 'Proveedor Bandeja SA', 1, 'factura', 'A', 3, 10, '2026-09-01', 100, 21, 121, 'pending_review'),
  ('00000000-0000-0000-0000-0000000ac302', 'upload', '30755555551', 'Proveedor Bandeja SA', 1, 'factura', 'A', 3, 11, '2026-09-01', 100, 21, 121, 'pending_review'),
  ('00000000-0000-0000-0000-0000000ac303', 'upload', '30755555551', 'Proveedor Bandeja SA', 1, 'factura', 'A', 3, 12, '2026-09-01', 100, 21, 121, 'pending_review'),
  ('00000000-0000-0000-0000-0000000ac304', 'upload', '30755555551', 'Proveedor Bandeja SA', 1, 'factura', 'A', 3, 13, '2026-09-01', 100, 21, 121, 'pending_review'),
  ('00000000-0000-0000-0000-0000000ac305', 'upload', '30755555551', 'Proveedor Bandeja SA', 1, 'factura', 'A', 4, 10, '2026-09-01', 100, 21, 121, 'pending_review'),
  ('00000000-0000-0000-0000-0000000ac306', 'upload', '30755555551', 'Proveedor Bandeja SA', 1, 'factura', 'A', 3, 20, '2026-09-02', 100, 21, 121, 'pending_review'),
  ('00000000-0000-0000-0000-0000000ac307', 'upload', '30755555551', 'Proveedor Bandeja SA', 1, 'factura', 'A', 3, 21, '2026-09-02', 100, 21, 121, 'discarded'),
  ('00000000-0000-0000-0000-0000000ac308', 'upload', '30755555551', 'Proveedor Bandeja SA', 51, null, null, 3, 30, '2026-09-02', 100, 21, 121, 'unsupported');

-- 1. Grants and RLS ----------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.link_received_vouchers(uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.link_received_vouchers(uuid[])', 'execute')
  and has_function_privilege('service_role', 'public.link_received_vouchers(uuid[])', 'execute'),
  'only the service role runs link_received_vouchers'
);

select ok(
  not has_table_privilege('authenticated', 'public.arca_received_vouchers', 'insert')
  and not has_table_privilege('authenticated', 'public.arca_received_vouchers', 'update')
  and not has_table_privilege('authenticated', 'public.arca_received_vouchers', 'delete')
  and not has_table_privilege('anon', 'public.arca_received_vouchers', 'select'),
  'authenticated only reads the tray; anon nothing'
);

-- 2. Link --------------------------------------------------------------------------

select is(
  public.link_received_vouchers(array[
    '00000000-0000-0000-0000-0000000ac301', '00000000-0000-0000-0000-0000000ac302',
    '00000000-0000-0000-0000-0000000ac303', '00000000-0000-0000-0000-0000000ac304',
    '00000000-0000-0000-0000-0000000ac305']::uuid[]),
  2,
  'two of five vouchers have a received fiscal purchase with the same key'
);

select is(
  (select purchase_invoice_id from public.arca_received_vouchers where id = '00000000-0000-0000-0000-0000000ac301'),
  '00000000-0000-0000-0000-0000000ac201'::uuid,
  'same letter links'
);

select is(
  (select purchase_invoice_id from public.arca_received_vouchers where id = '00000000-0000-0000-0000-0000000ac303'),
  '00000000-0000-0000-0000-0000000ac203'::uuid,
  'a purchase loaded without letter links'
);

select results_eq(
  $$ select status from public.arca_received_vouchers
      where id in ('00000000-0000-0000-0000-0000000ac302', '00000000-0000-0000-0000-0000000ac304',
                   '00000000-0000-0000-0000-0000000ac305') order by id $$,
  $$ values ('pending_review'::text), ('pending_review'), ('pending_review') $$,
  'a cancelled purchase, a number not loaded and another punto de venta do not link'
);

select is(
  public.link_received_vouchers(array['00000000-0000-0000-0000-0000000ac301']::uuid[]),
  0,
  'a confirmed voucher is not linked again'
);

-- 3. Trigger -----------------------------------------------------------------------

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, moneda, cotizacion, status)
values
  ('00000000-0000-0000-0000-0000000ac205', 'jouve_fiscal', '00000000-0000-0000-0000-0000000ac101',
   'factura', 'A', 3, 20, '2026-09-02', 100, 21, 121, 'PES', 1, 'received'),
  ('00000000-0000-0000-0000-0000000ac206', 'jouve_fiscal', '00000000-0000-0000-0000-0000000ac101',
   'factura', 'A', 3, 21, '2026-09-02', 100, 21, 121, 'PES', 1, 'received');

select results_eq(
  $$ select id::text, status, purchase_invoice_id::text from public.arca_received_vouchers
      where id in ('00000000-0000-0000-0000-0000000ac306', '00000000-0000-0000-0000-0000000ac307') order by id $$,
  $$ values ('00000000-0000-0000-0000-0000000ac306'::text, 'confirmed'::text, '00000000-0000-0000-0000-0000000ac205'::text),
            ('00000000-0000-0000-0000-0000000ac307', 'confirmed', '00000000-0000-0000-0000-0000000ac206') $$,
  'a purchase loaded later links a pending voucher and a discarded one through the trigger'
);

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, moneda, cotizacion, status)
values
  ('00000000-0000-0000-0000-0000000ac207', 'jouve_fiscal', '00000000-0000-0000-0000-0000000ac101',
   'factura', 'A', 4, 99, '2026-09-01', 100, 21, 121, 'PES', 1, 'received');
update public.purchase_invoices set numero = 10
 where id = '00000000-0000-0000-0000-0000000ac207';

select is(
  (select purchase_invoice_id from public.arca_received_vouchers where id = '00000000-0000-0000-0000-0000000ac305'),
  '00000000-0000-0000-0000-0000000ac207'::uuid,
  'a purchase edited into the voucher''s number links it'
);

-- 4. Shape -------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.arca_received_vouchers
       (origin, issuer_cuit, issuer_name, cbte_tipo, kind, letter, punto_venta, numero, fecha, imp_total, status)
     values ('upload', '30755555551', 'X', 51, null, null, 3, 40, '2026-09-02', 10, 'pending_review') $$,
  '23514',
  null,
  'a voucher without kind must be unsupported'
);

select throws_ok(
  $$ insert into public.arca_received_vouchers
       (origin, issuer_cuit, issuer_name, cbte_tipo, kind, letter, punto_venta, numero, fecha, imp_total)
     values ('upload', '30755555551', 'X', 1, 'factura', 'A', 3, 10, '2026-09-01', 121) $$,
  '23505',
  null,
  'the same CUIT, tipo, punto de venta and número is one voucher'
);

-- 5. Who reads ---------------------------------------------------------------------

set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000ac001","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.arca_received_vouchers where issuer_cuit = '30755555551'),
  8,
  'finance reads the tray'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000ac002","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.arca_received_vouchers),
  0,
  'the accountant (fiscal_reader) does not'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000ac003","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.arca_received_vouchers),
  0,
  'operations does not'
);

reset role;

select * from finish();
rollback;
