-- A recibo or liquidación loaded as a factura keeps its AFIP code
-- (20261106190000), and so does an M loaded as an A of its kind
-- (20261106201042), and a public-service liquidación or Recibo M
-- (20261106205121): only on the matching kind and letter, and
-- create_purchase_invoice takes it. One transaction, rolled back.

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(11);

insert into public.suppliers (id, cuit, legal_name, iva_condition, is_fiscal) values
  ('00000000-0000-0000-0000-0000000c6101', '30500010912', 'Banco Liquidación SA', 'responsable_inscripto', true);

create function pg_temp.add(p_numero int, p_kind text, p_letter text, p_tipo int)
returns void language sql as $$
  insert into public.purchase_invoices
    (channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
     imp_neto, imp_iva, imp_total, moneda, cotizacion, status, cbte_tipo_afip)
  values
    ('jouve_fiscal', '00000000-0000-0000-0000-0000000c6101', p_kind, p_letter,
     63, p_numero, '2026-09-30', 100, 21, 121, 'PES', 1, 'received', p_tipo);
$$;

select lives_ok(
  $$select pg_temp.add(1, 'factura', 'A', 63)$$,
  'a Liquidación A is a factura A with code 63'
);

select throws_ok(
  $$select pg_temp.add(2, 'factura', 'A', 64)$$,
  '23514',
  'new row for relation "purchase_invoices" violates check constraint "purchase_invoices_cbte_tipo_afip_check"',
  'a Liquidación B is never a letter A'
);

select throws_ok(
  $$select pg_temp.add(3, 'factura', 'A', 15)$$,
  '23514',
  'new row for relation "purchase_invoices" violates check constraint "purchase_invoices_cbte_tipo_afip_check"',
  'a Recibo C is never a letter A'
);

select throws_ok(
  $$select pg_temp.add(4, 'factura', 'A', 1)$$,
  '23514',
  'new row for relation "purchase_invoices" violates check constraint "purchase_invoices_cbte_tipo_afip_check"',
  'a plain factura carries no code of its own'
);

select lives_ok(
  $$select pg_temp.add(5, 'factura', 'A', 51)$$,
  'a Factura M is a factura A with code 51'
);

select lives_ok(
  $$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
       imp_neto, imp_iva, imp_total, moneda, cotizacion, status, cbte_tipo_afip,
       invoice_origin_id)
    select 'jouve_fiscal', '00000000-0000-0000-0000-0000000c6101', 'nd', 'A',
           63, 6, '2026-09-30', 100, 21, 121, 'PES', 1, 'received', 52, f.id
      from public.purchase_invoices f
     where f.supplier_id = '00000000-0000-0000-0000-0000000c6101'
       and f.numero = 5$$,
  'an ND M is an ND A with code 52'
);

select throws_ok(
  $$select pg_temp.add(7, 'factura', 'A', 53)$$,
  '23514',
  'new row for relation "purchase_invoices" violates check constraint "purchase_invoices_cbte_tipo_afip_check"',
  'an NC M is never a factura'
);

select throws_ok(
  $$select pg_temp.add(8, 'factura', 'A', 52)$$,
  '23514',
  'new row for relation "purchase_invoices" violates check constraint "purchase_invoices_cbte_tipo_afip_check"',
  'an ND M code is never on a factura'
);

select lives_ok(
  $$select pg_temp.add(9, 'factura', 'A', 17)$$,
  'a public-service liquidación A is a factura A with code 17'
);

select throws_ok(
  $$select pg_temp.add(10, 'factura', 'A', 18)$$,
  '23514',
  'new row for relation "purchase_invoices" violates check constraint "purchase_invoices_cbte_tipo_afip_check"',
  'a public-service liquidación B is never a letter A'
);

select ok(
  'cbte_tipo_afip' = any (public.purchase_invoice_editable_fields()),
  'create_purchase_invoice takes the code'
);

select * from finish();
rollback;
