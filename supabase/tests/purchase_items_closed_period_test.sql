-- The items of a fiscal purchase in a closed period are frozen
-- (20261104132100): replace_purchase_invoice_items refuses removing them or
-- moving neto/IVA between alícuotas, re-saving the same split passes, and a
-- direct write to the table is refused. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select plan(9);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.suppliers (id, cuit, legal_name, iva_condition, is_fiscal) values
  ('00000000-0000-0000-0000-0000000c1d01', '30711111118', 'Proveedor Período Cerrado SA', 'responsable_inscripto', true);

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, moneda, cotizacion)
values
  ('00000000-0000-0000-0000-0000000c1d11', 'jouve_fiscal', '00000000-0000-0000-0000-0000000c1d01',
   'factura', 'A', 9, 701, '2026-08-10', 300, 52.5, 352.5, 'PES', 1);

select public.replace_purchase_invoice_items('00000000-0000-0000-0000-0000000c1d11',
  '[{"description":"Flete","quantity":1,"unit_price":200,"iva_rate_id":5,"line_neto":200,"line_iva":42,"line_total":242},
    {"description":"Repuesto","quantity":1,"unit_price":100,"iva_rate_id":4,"line_neto":100,"line_iva":10.5,"line_total":110.5}]'::jsonb);
set constraints all immediate;

insert into public.accounting_closed_periods (period) values ('2026-08');

select throws_ok(
  $$ select public.replace_purchase_invoice_items('00000000-0000-0000-0000-0000000c1d11', '[]'::jsonb) $$,
  '55006',
  'El período contable de la factura está cerrado: no se pueden cambiar datos que figuran en el Libro IVA Compras',
  'removing the items of a closed period''s purchase is refused'
);

select throws_ok(
  $$ select public.replace_purchase_invoice_items('00000000-0000-0000-0000-0000000c1d11',
       '[{"description":"Flete","quantity":1,"unit_price":200,"iva_rate_id":4,"line_neto":200,"line_iva":42,"line_total":242},
         {"description":"Repuesto","quantity":1,"unit_price":100,"iva_rate_id":5,"line_neto":100,"line_iva":10.5,"line_total":110.5}]'::jsonb) $$,
  '55006',
  null,
  'swapping alícuotas with the same header totals is refused'
);

select lives_ok(
  $$ set constraints all deferred;
     select public.replace_purchase_invoice_items('00000000-0000-0000-0000-0000000c1d11',
       '[{"description":"Repuesto y mano de obra","quantity":2,"unit_price":50,"iva_rate_id":4,"line_neto":100,"line_iva":10.5,"line_total":110.5},
         {"description":"Flete A","quantity":1,"unit_price":120,"iva_rate_id":5,"line_neto":120,"line_iva":25.2,"line_total":145.2},
         {"description":"Flete B","quantity":1,"unit_price":80,"iva_rate_id":5,"line_neto":80,"line_iva":16.8,"line_total":96.8}]'::jsonb);
     set constraints all immediate $$,
  're-saving the same neto and IVA per alícuota passes (the edit form always sends the items)'
);

select results_eq(
  $$ select iva_rate_id, sum(line_neto), sum(line_iva)
       from public.purchase_invoice_items
      where purchase_invoice_id = '00000000-0000-0000-0000-0000000c1d11'
      group by iva_rate_id order by iva_rate_id $$,
  $$ values (4, 100.00, 10.50), (5, 200.00, 42.00) $$,
  'and the book reads the same split'
);

select throws_ok(
  $$ delete from public.purchase_invoice_items
      where purchase_invoice_id = '00000000-0000-0000-0000-0000000c1d11' and iva_rate_id = 4 $$,
  '55006',
  null,
  'a direct delete of a closed period''s item is refused'
);

select throws_ok(
  $$ update public.purchase_invoice_items set iva_rate_id = 6
      where purchase_invoice_id = '00000000-0000-0000-0000-0000000c1d11' and iva_rate_id = 4 $$,
  '55006',
  null,
  'a direct alícuota change is refused'
);

select throws_ok(
  $$ insert into public.purchase_invoice_items
       (purchase_invoice_id, description, quantity, unit_price, iva_rate_id, line_neto, line_iva, line_total)
     values ('00000000-0000-0000-0000-0000000c1d11', 'Extra', 1, 10, 5, 10, 2.1, 12.1) $$,
  '55006',
  null,
  'a direct insert into a closed period''s purchase is refused'
);

delete from public.accounting_closed_periods where period = '2026-08';

select lives_ok(
  $$ set constraints all deferred;
     select public.replace_purchase_invoice_items('00000000-0000-0000-0000-0000000c1d11', '[]'::jsonb);
     set constraints all immediate $$,
  'once the period is open again the items can be removed'
);

select is(
  (select count(*)::int from public.purchase_invoice_items
    where purchase_invoice_id = '00000000-0000-0000-0000-0000000c1d11'),
  0,
  'and they are gone'
);

select * from finish();
rollback;
