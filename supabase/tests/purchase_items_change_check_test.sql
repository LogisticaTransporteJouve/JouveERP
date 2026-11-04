-- purchase_items_change_refused (20261104140100) answers, before any write,
-- what replace_purchase_invoice_items refuses in a closed period: the edit
-- action asks it before saving the header. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select plan(9);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.suppliers (id, cuit, legal_name, iva_condition, is_fiscal) values
  ('00000000-0000-0000-0000-0000000c2d01', '30722222224', 'Proveedor Chequeo Ítems SA', 'responsable_inscripto', true);

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, moneda, cotizacion)
values
  ('00000000-0000-0000-0000-0000000c2d11', 'jouve_fiscal', '00000000-0000-0000-0000-0000000c2d01',
   'factura', 'A', 9, 702, '2026-08-10', 100000, 21050, 121050, 'PES', 1);

-- An ARCA-accepted line: its IVA is ARCA's, not round(neto × 21 %).
select public.replace_purchase_invoice_items('00000000-0000-0000-0000-0000000c2d11',
  '[{"description":"Servicio","quantity":1,"unit_price":100000,"iva_rate_id":5,"line_neto":100000,"line_iva":21050,"line_total":121050}]'::jsonb);
set constraints all immediate;

select is(
  public.purchase_items_change_refused('00000000-0000-0000-0000-0000000c2d11', '[]'::jsonb),
  false,
  'an open period refuses nothing'
);

insert into public.accounting_closed_periods (period) values ('2026-08');

select is(
  public.purchase_items_change_refused('00000000-0000-0000-0000-0000000c2d11',
    '[{"description":"Servicio y flete","quantity":1,"unit_price":100000,"iva_rate_id":5,"line_neto":100000,"line_iva":21050,"line_total":121050}]'::jsonb),
  false,
  'the stored neto and IVA re-sent (a notes-only edit) pass'
);

select is(
  public.purchase_items_change_refused('00000000-0000-0000-0000-0000000c2d11',
    '[{"description":"Servicio","quantity":1,"unit_price":100000,"iva_rate_id":5,"line_neto":100000,"line_iva":21000,"line_total":121000}]'::jsonb),
  true,
  'an IVA recomputed as neto × rate is a change'
);

select is(
  public.purchase_items_change_refused('00000000-0000-0000-0000-0000000c2d11', '[]'::jsonb),
  true,
  'removing the items is a change'
);

select is(
  public.purchase_items_change_refused('00000000-0000-0000-0000-0000000c2d11',
    '[{"description":"Servicio","quantity":1,"unit_price":100000,"iva_rate_id":4,"line_neto":100000,"line_iva":21050,"line_total":121050}]'::jsonb),
  true,
  'moving the line to another alícuota is a change'
);

select throws_ok(
  $$ select public.replace_purchase_invoice_items('00000000-0000-0000-0000-0000000c2d11', '[]'::jsonb) $$,
  '55006',
  'El período contable de la factura está cerrado: no se pueden cambiar datos que figuran en el Libro IVA Compras',
  'the RPC still refuses what the predicate refuses'
);

select lives_ok(
  $$ set constraints all deferred;
     select public.replace_purchase_invoice_items('00000000-0000-0000-0000-0000000c2d11',
       '[{"description":"Servicio y flete","quantity":1,"unit_price":100000,"iva_rate_id":5,"line_neto":100000,"line_iva":21050,"line_total":121050}]'::jsonb);
     set constraints all immediate $$,
  'and saves what the predicate lets through'
);

select is(
  (select imp_iva from public.purchase_invoices where id = '00000000-0000-0000-0000-0000000c2d11'),
  21050.00::numeric,
  'keeping ARCA''s IVA on the header'
);

select ok(
  not has_function_privilege('anon',
    'public.purchase_items_change_refused(uuid, jsonb)', 'execute')
  and has_function_privilege('authenticated',
    'public.purchase_items_change_refused(uuid, jsonb)', 'execute'),
  'anon cannot call the predicate; authenticated can (its role check gates writers)'
);

select * from finish();
rollback;
