-- A supplier's CUIT change re-checks its received vouchers
-- (20261104141000): the ones linked under the old CUIT go back to pending,
-- and the pending ones under the new CUIT take its purchases. One
-- transaction, rolled back.

begin;

select plan(3);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.suppliers (id, cuit, legal_name, iva_condition, is_fiscal) values
  ('00000000-0000-0000-0000-0000000c0101', '30799999990', 'Proveedor Cuit SA', 'responsable_inscripto', true);

insert into public.arca_received_vouchers
  (id, origin, issuer_cuit, issuer_name, cbte_tipo, kind, letter, punto_venta, numero, fecha,
   imp_neto_gravado, imp_iva, imp_total, status)
values
  ('00000000-0000-0000-0000-0000000c0401', 'upload', '30799999990', 'Proveedor Cuit SA', 1, 'factura', 'A', 11, 1, '2026-09-01', 100, 21, 121, 'pending_review'),
  ('00000000-0000-0000-0000-0000000c0402', 'upload', '30711111118', 'Proveedor Cuit SA', 1, 'factura', 'A', 11, 1, '2026-09-01', 100, 21, 121, 'pending_review');

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, moneda, cotizacion, status)
values
  ('00000000-0000-0000-0000-0000000c0301', 'jouve_fiscal', '00000000-0000-0000-0000-0000000c0101',
   'factura', 'A', 11, 1, '2026-09-01', 100, 21, 121, 'PES', 1, 'received');
select is(
  (select purchase_invoice_id from public.arca_received_vouchers where id = '00000000-0000-0000-0000-0000000c0401'),
  '00000000-0000-0000-0000-0000000c0301'::uuid,
  'the voucher under the supplier''s CUIT takes the purchase'
);

-- The CUIT was typed wrong: corrected.
update public.suppliers set cuit = '30711111118' where id = '00000000-0000-0000-0000-0000000c0101';
select results_eq(
  $$ select status, purchase_invoice_id is null from public.arca_received_vouchers
      where id = '00000000-0000-0000-0000-0000000c0401' $$,
  $$ values ('pending_review'::text, true) $$,
  'the voucher under the old CUIT goes back to pending'
);
select is(
  (select purchase_invoice_id from public.arca_received_vouchers where id = '00000000-0000-0000-0000-0000000c0402'),
  '00000000-0000-0000-0000-0000000c0301'::uuid,
  'and the voucher under the new CUIT takes the purchase'
);

select * from finish();
rollback;
