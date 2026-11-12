-- Conciliación con ARCA (20261112130000): a voucher ARCA lists without
-- amounts sums on neither side, a B voucher with neto 0 and no breakdown reads
-- its neto as total − tributos, and a cent between ARCA's components and the
-- ERP's, with equal totals, is not a difference. One transaction, rolled back.

begin;

select plan(5);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.suppliers (id, cuit, legal_name, iva_condition, is_fiscal) values
  ('00000000-0000-0000-0000-0000000d0101', '30799999982', 'Proveedor Comparación SA', 'responsable_inscripto', true);

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_trib, imp_total, moneda, cotizacion, status)
values
  ('00000000-0000-0000-0000-0000000d0301', 'jouve_fiscal', '00000000-0000-0000-0000-0000000d0101',
   'factura', 'A', 9, 1, '2026-09-01', 400, 108, 110, 618, 'PES', 1, 'received'),
  ('00000000-0000-0000-0000-0000000d0302', 'jouve_fiscal', '00000000-0000-0000-0000-0000000d0101',
   'factura', 'B', 9, 2, '2026-09-02', 112, 0, 38, 150, 'PES', 1, 'received'),
  ('00000000-0000-0000-0000-0000000d0303', 'jouve_fiscal', '00000000-0000-0000-0000-0000000d0101',
   'factura', 'A', 9, 3, '2026-09-03', 66940.49, 14057.51, 0, 80998, 'PES', 1, 'received');

insert into public.arca_received_vouchers
  (id, origin, issuer_cuit, issuer_name, cbte_tipo, kind, letter, punto_venta, numero, fecha,
   moneda, cotizacion, imp_neto_gravado, imp_iva, imp_trib, imp_total, status, purchase_invoice_id)
values
  -- A type that is not loaded on its own (a tipo 17 liquidación), linked to
  -- its purchase: ARCA's amounts are not compared.
  ('00000000-0000-0000-0000-0000000d0401', 'upload', '30799999982', 'Proveedor Comparación SA', 17, null, null, 9, 1, '2026-09-01',
   'PES', null, 0, 0, 0, 0, 'unsupported', '00000000-0000-0000-0000-0000000d0301'),
  -- B with neto 0 and nothing in no gravado or exento.
  ('00000000-0000-0000-0000-0000000d0402', 'upload', '30799999982', 'Proveedor Comparación SA', 6, 'factura', 'B', 9, 2, '2026-09-02',
   'PES', null, 0, 0, 38, 150, 'pending_review', null),
  -- Components a cent off ARCA's own total.
  ('00000000-0000-0000-0000-0000000d0403', 'upload', '30799999982', 'Proveedor Comparación SA', 1, 'factura', 'A', 9, 3, '2026-09-03',
   'PES', null, 66940.50, 14057.51, 0, 80998, 'pending_review', null);

select is(
  (select row(arca_total, erp_total)::text from public.purchase_arca_reconciliation_rows()
    where voucher_id = '00000000-0000-0000-0000-0000000d0401'),
  row(null::numeric, null::numeric)::text,
  'a voucher without amounts sums on neither side'
);

select isnt(
  (select erp_fecha from public.purchase_arca_reconciliation_rows()
    where voucher_id = '00000000-0000-0000-0000-0000000d0401'),
  null,
  'its purchase still counts on the ERP side'
);

select is(
  (select arca_neto from public.purchase_arca_reconciliation_rows()
    where voucher_id = '00000000-0000-0000-0000-0000000d0402'),
  112::numeric,
  'a B voucher with neto 0 and no breakdown reads total − tributos'
);

select is(
  (select arca_neto - erp_neto from public.purchase_arca_reconciliation_rows()
    where voucher_id = '00000000-0000-0000-0000-0000000d0403'),
  0::numeric,
  'a cent in a component with equal totals is not a difference'
);

select is(
  (select arca_neto - erp_neto
     from public.purchase_arca_reconciliation_months()
    where month = '2026-09-01'),
  0::numeric,
  'the month shows no neto difference'
);

select * from finish();
rollback;
