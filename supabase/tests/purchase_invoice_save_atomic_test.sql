-- create_purchase_invoice / update_purchase_invoice (20261106112000) save the
-- header and the items in one transaction: when the items are refused, the
-- header is not saved either. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select plan(8);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.suppliers (id, cuit, legal_name, iva_condition, is_fiscal) values
  ('00000000-0000-0000-0000-0000000c3a01', '30733333339', 'Proveedor Guardado Atómico SA', 'responsable_inscripto', true);

-- Exento in the header and a line without alícuota: the items step refuses it.
select throws_ok(
  $$ select public.create_purchase_invoice(
       '{"channel_id":"jouve_fiscal","supplier_id":"00000000-0000-0000-0000-0000000c3a01","kind":"factura","letter":"A","punto_venta":9,"numero":801,"fecha":"2026-08-10","imp_neto":100,"imp_iva":21,"imp_op_exentas":10,"imp_total":131,"moneda":"PES","cotizacion":1}'::jsonb,
       '[{"description":"Servicio","quantity":1,"unit_price":100,"iva_rate_id":null,"line_neto":100,"line_iva":0,"line_total":100}]'::jsonb) $$,
  '23514',
  'Con exento o no gravado en el encabezado, los ítems deben tener alícuota.',
  'a refused item fails the create'
);

select is(
  (select count(*) from public.purchase_invoices
    where supplier_id = '00000000-0000-0000-0000-0000000c3a01' and numero = 801),
  0::bigint,
  'and leaves no header behind'
);

select throws_ok(
  $$ select public.create_purchase_invoice('{"status":"cancelled"}'::jsonb, null) $$,
  'P0001',
  'p_header has a field that is not editable',
  'a field outside the editable list is refused'
);

create temp table saved on commit drop as
select public.create_purchase_invoice(
  '{"channel_id":"jouve_fiscal","supplier_id":"00000000-0000-0000-0000-0000000c3a01","kind":"factura","letter":"A","punto_venta":9,"numero":802,"fecha":"2026-08-10","imp_neto":100000,"imp_iva":21050,"imp_total":121050,"moneda":"PES","cotizacion":1}'::jsonb,
  '[{"description":"Servicio","quantity":1,"unit_price":100000,"iva_rate_id":5,"line_neto":100000,"line_iva":21050,"line_total":121050}]'::jsonb
) as id;
set constraints all immediate;

select is(
  (select count(*) from public.purchase_invoice_items it join saved s on s.id = it.purchase_invoice_id),
  1::bigint,
  'a create saves the header with its items'
);

insert into public.accounting_closed_periods (period) values ('2026-08');

-- Notes alone may change in a closed period; removing the items may not.
select throws_ok(
  format($$ select public.update_purchase_invoice(%L, '{"notes":"Vence en dos pagos"}'::jsonb, '[]'::jsonb) $$,
         (select id from saved)),
  '55006',
  'El período contable de la factura está cerrado: no se pueden cambiar datos que figuran en el Libro IVA Compras',
  'an update whose items are refused fails'
);

select is(
  (select notes from public.purchase_invoices pi join saved s on s.id = pi.id),
  null::text,
  'and does not save its header either'
);

select is(
  public.update_purchase_invoice('00000000-0000-0000-0000-0000000c3aff', '{"notes":"x"}'::jsonb, null),
  null::uuid,
  'an update of a purchase that is not there returns null'
);

select ok(
  not has_function_privilege('anon', 'public.update_purchase_invoice(uuid, jsonb, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.create_purchase_invoice(jsonb, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.create_purchase_invoice(jsonb, jsonb)', 'execute'),
  'anon cannot call them; authenticated can (RLS and the items guard gate writers)'
);

select * from finish();
rollback;
