-- Conciliación con ARCA for purchases (20261106223000): a voucher with no
-- fiscal purchase of its key is only in ARCA, a purchase with no voucher only
-- in the ERP, a pair whose total differs is listed apart, a discarded voucher
-- does not count, and a USD voucher sums in ARS at its cotización. Only the
-- service role executes the functions. One transaction, rolled back.

begin;

select plan(5);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.suppliers (id, cuit, legal_name, iva_condition, is_fiscal) values
  ('00000000-0000-0000-0000-0000000c0101', '30799999991', 'Proveedor Conciliación SA', 'responsable_inscripto', true);

insert into public.arca_received_vouchers
  (id, origin, issuer_cuit, issuer_name, cbte_tipo, kind, letter, punto_venta, numero, fecha,
   moneda, cotizacion, imp_neto_gravado, imp_iva, imp_total, status)
values
  -- Matched, same total.
  ('00000000-0000-0000-0000-0000000c0401', 'upload', '30799999991', 'Proveedor Conciliación SA', 1, 'factura', 'A', 7, 1, '2026-09-01', 'PES', null, 100, 21, 121, 'pending_review'),
  -- Only in ARCA, in dollars.
  ('00000000-0000-0000-0000-0000000c0402', 'upload', '30799999991', 'Proveedor Conciliación SA', 1, 'factura', 'A', 7, 2, '2026-09-02', 'DOL', 1000, 10, 0, 10, 'pending_review'),
  -- Matched by key, but the purchase says 125.
  ('00000000-0000-0000-0000-0000000c0403', 'upload', '30799999991', 'Proveedor Conciliación SA', 1, 'factura', 'A', 7, 4, '2026-09-04', 'PES', null, 100, 21, 121, 'pending_review'),
  -- Discarded: not compared.
  ('00000000-0000-0000-0000-0000000c0404', 'upload', '30799999991', 'Proveedor Conciliación SA', 1, 'factura', 'A', 7, 5, '2026-09-05', 'PES', null, 100, 21, 121, 'discarded');

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, moneda, cotizacion, status)
values
  ('00000000-0000-0000-0000-0000000c0301', 'jouve_fiscal', '00000000-0000-0000-0000-0000000c0101',
   'factura', 'A', 7, 1, '2026-09-01', 100, 21, 121, 'PES', 1, 'received'),
  -- Only in the ERP.
  ('00000000-0000-0000-0000-0000000c0302', 'jouve_fiscal', '00000000-0000-0000-0000-0000000c0101',
   'factura', 'A', 7, 3, '2026-09-03', 100, 21, 121, 'PES', 1, 'received'),
  ('00000000-0000-0000-0000-0000000c0303', 'jouve_fiscal', '00000000-0000-0000-0000-0000000c0101',
   'factura', 'A', 7, 4, '2026-09-04', 100, 25, 125, 'PES', 1, 'received');

select results_eq(
  $$ select issue, numero, voucher_id, purchase_invoice_id
       from public.purchase_arca_reconciliation_detail('2026-09-01', '2026-09-30', 50)
      where issuer_cuit = '30799999991'
      order by issue, numero $$,
  $$ values
       ('amount_mismatch'::text, 4::bigint, '00000000-0000-0000-0000-0000000c0403'::uuid, '00000000-0000-0000-0000-0000000c0303'::uuid),
       ('arca_only', 2, '00000000-0000-0000-0000-0000000c0402'::uuid, null::uuid),
       ('erp_only', 3, null::uuid, '00000000-0000-0000-0000-0000000c0302'::uuid) $$,
  'lists the voucher only in ARCA, the purchase only in the ERP and the pair whose total differs'
);

select is(
  (select arca_total from public.purchase_arca_reconciliation_rows()
    where voucher_id = '00000000-0000-0000-0000-0000000c0402'),
  10000::numeric,
  'a USD voucher sums in ARS at its cotización'
);

select is(
  (select count(*)::int from public.purchase_arca_reconciliation_rows()
    where voucher_id = '00000000-0000-0000-0000-0000000c0404'),
  0,
  'a discarded voucher is not compared'
);

select ok(
  not has_function_privilege('authenticated', 'public.purchase_arca_reconciliation_months()', 'execute')
  and not has_function_privilege('anon', 'public.purchase_arca_reconciliation_months()', 'execute'),
  'authenticated and anon cannot execute the months'
);

select ok(
  not has_function_privilege('authenticated', 'public.purchase_arca_reconciliation_detail(date, date, int)', 'execute')
  and not has_function_privilege('authenticated', 'public.purchase_arca_reconciliation_rows()', 'execute'),
  'authenticated cannot execute the detail or the rows'
);

select * from finish();
rollback;
