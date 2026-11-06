-- A recibo or liquidación loaded as a factura keeps its AFIP code
-- (20261106190000): only on a factura of the matching letter, and
-- create_purchase_invoice takes it. One transaction, rolled back.

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(5);

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

select ok(
  'cbte_tipo_afip' = any (public.purchase_invoice_editable_fields()),
  'create_purchase_invoice takes the code'
);

select * from finish();
rollback;
