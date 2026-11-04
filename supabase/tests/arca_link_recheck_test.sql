-- A received voucher stays linked only while its purchase says what ARCA
-- says (20261104122000): editing the purchase's amounts unlinks it, editing
-- them back links it again; on a letter A the IVA counts, and the currency
-- always does. One transaction, rolled back.

begin;

select plan(6);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.suppliers (id, cuit, legal_name, iva_condition, is_fiscal) values
  ('00000000-0000-0000-0000-0000000af101', '30777777773', 'Proveedor Recheck SA', 'responsable_inscripto', true);

insert into public.arca_received_vouchers
  (id, origin, issuer_cuit, issuer_name, cbte_tipo, kind, letter, punto_venta, numero, fecha,
   imp_neto_gravado, imp_iva, imp_total, status)
values
  ('00000000-0000-0000-0000-0000000af401', 'upload', '30777777773', 'Proveedor Recheck SA', 1, 'factura', 'A', 7, 1, '2026-09-01', 100, 21, 121, 'pending_review'),
  ('00000000-0000-0000-0000-0000000af402', 'upload', '30777777773', 'Proveedor Recheck SA', 1, 'factura', 'A', 7, 2, '2026-09-01', 100, 21, 121, 'pending_review');

-- Loaded by hand with ARCA's amounts: the trigger links it.
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, moneda, cotizacion, status)
values
  ('00000000-0000-0000-0000-0000000af301', 'jouve_fiscal', '00000000-0000-0000-0000-0000000af101',
   'factura', 'A', 7, 1, '2026-09-01', 100, 21, 121, 'PES', 1, 'received');
select is(
  (select purchase_invoice_id from public.arca_received_vouchers where id = '00000000-0000-0000-0000-0000000af401'),
  '00000000-0000-0000-0000-0000000af301'::uuid,
  'a purchase with ARCA''s amounts takes the voucher'
);

update public.purchase_invoices
   set imp_neto = 200, imp_iva = 42, imp_total = 242
 where id = '00000000-0000-0000-0000-0000000af301';
select results_eq(
  $$ select status, purchase_invoice_id is null from public.arca_received_vouchers
      where id = '00000000-0000-0000-0000-0000000af401' $$,
  $$ values ('pending_review'::text, true) $$,
  'editing its amounts away from ARCA''s sends the voucher back to pending'
);

update public.purchase_invoices
   set imp_neto = 100, imp_iva = 21, imp_total = 121
 where id = '00000000-0000-0000-0000-0000000af301';
select is(
  (select status from public.arca_received_vouchers where id = '00000000-0000-0000-0000-0000000af401'),
  'confirmed',
  'editing them back links it again'
);

-- Same total, other IVA: on a letter A that is another document.
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_no_gravado, imp_total, moneda, cotizacion, status)
values
  ('00000000-0000-0000-0000-0000000af302', 'jouve_fiscal', '00000000-0000-0000-0000-0000000af101',
   'factura', 'A', 7, 2, '2026-09-01', 100, 10.5, 10.5, 121, 'PES', 1, 'received');
select is(
  (select status from public.arca_received_vouchers where id = '00000000-0000-0000-0000-0000000af402'),
  'pending_review',
  'on a letter A, the same total with another IVA does not take the voucher'
);

select ok(
  not public.purchase_matches_received(121, 21, 'DOL', 121, 21, 'PES', 'A'),
  'another currency does not match'
);
select ok(
  public.purchase_matches_received(121, 0, 'PES', 121.01, 21, 'PES', 'B'),
  'on a B the IVA is not compared, and a rounding cent is tolerated'
);

select * from finish();
rollback;
