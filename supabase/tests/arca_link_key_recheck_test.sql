-- A received voucher stays linked only while its purchase is the same
-- document (20261104131000): editing the purchase's número sends the voucher
-- back to pending and lets the voucher with the new número take it; a
-- purchase holds at most one voucher. One transaction, rolled back.

begin;

select plan(4);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.suppliers (id, cuit, legal_name, iva_condition, is_fiscal) values
  ('00000000-0000-0000-0000-0000000b0101', '30788888884', 'Proveedor Clave SA', 'responsable_inscripto', true);

insert into public.arca_received_vouchers
  (id, origin, issuer_cuit, issuer_name, cbte_tipo, kind, letter, punto_venta, numero, fecha,
   imp_neto_gravado, imp_iva, imp_total, status)
values
  ('00000000-0000-0000-0000-0000000b0401', 'upload', '30788888884', 'Proveedor Clave SA', 1, 'factura', 'A', 9, 1, '2026-09-01', 100, 21, 121, 'pending_review'),
  ('00000000-0000-0000-0000-0000000b0402', 'upload', '30788888884', 'Proveedor Clave SA', 1, 'factura', 'A', 9, 2, '2026-09-01', 100, 21, 121, 'pending_review');

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, moneda, cotizacion, status)
values
  ('00000000-0000-0000-0000-0000000b0301', 'jouve_fiscal', '00000000-0000-0000-0000-0000000b0101',
   'factura', 'A', 9, 1, '2026-09-01', 100, 21, 121, 'PES', 1, 'received');
select is(
  (select purchase_invoice_id from public.arca_received_vouchers where id = '00000000-0000-0000-0000-0000000b0401'),
  '00000000-0000-0000-0000-0000000b0301'::uuid,
  'the purchase takes the voucher with its número'
);

-- Typed the wrong número: corrected to 2.
update public.purchase_invoices set numero = 2 where id = '00000000-0000-0000-0000-0000000b0301';
select results_eq(
  $$ select status, purchase_invoice_id is null from public.arca_received_vouchers
      where id = '00000000-0000-0000-0000-0000000b0401' $$,
  $$ values ('pending_review'::text, true) $$,
  'the voucher of the old número goes back to pending'
);
select is(
  (select purchase_invoice_id from public.arca_received_vouchers where id = '00000000-0000-0000-0000-0000000b0402'),
  '00000000-0000-0000-0000-0000000b0301'::uuid,
  'and the voucher of the new número takes the purchase'
);

-- An old purchase without letter matches both an A and a B with its
-- número (the letter is unknown): only one of them takes it.
insert into public.arca_received_vouchers
  (id, origin, issuer_cuit, issuer_name, cbte_tipo, kind, letter, punto_venta, numero, fecha,
   imp_neto_gravado, imp_iva, imp_total, status)
values
  ('00000000-0000-0000-0000-0000000b0403', 'upload', '30788888884', 'Proveedor Clave SA', 1, 'factura', 'A', 9, 3, '2026-09-01', 100, 0, 100, 'pending_review'),
  ('00000000-0000-0000-0000-0000000b0404', 'upload', '30788888884', 'Proveedor Clave SA', 6, 'factura', 'B', 9, 3, '2026-09-01', 100, 0, 100, 'pending_review');
alter table public.purchase_invoices disable trigger purchase_invoices_fiscal_letter;
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, moneda, cotizacion, status)
values
  ('00000000-0000-0000-0000-0000000b0302', 'jouve_fiscal', '00000000-0000-0000-0000-0000000b0101',
   'factura', null, 9, 3, '2026-09-01', 100, 0, 100, 'PES', 1, 'received');
alter table public.purchase_invoices enable trigger purchase_invoices_fiscal_letter;
select is(
  (select count(*)::int from public.arca_received_vouchers
    where purchase_invoice_id = '00000000-0000-0000-0000-0000000b0302' and status = 'confirmed'),
  1,
  'a purchase holds one voucher, even when two match it'
);

select * from finish();
rollback;
