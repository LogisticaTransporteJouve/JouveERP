-- A fiscal purchase's total equals the sum of its parts, to the cent
-- (20261104112000, exact since 20261104120500), and a fiscal B or C carries
-- no IVA, exento or no gravado (20261104120500): refused on insert and on an
-- amount edit; an existing row with a gap still saves when its amounts stay
-- as they are; internal purchases are left alone. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select plan(13);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.suppliers (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000b5f01', true, '30999999994', 'Proveedor Total Partes', 'responsable_inscripto'),
  ('00000000-0000-0000-0000-0000000b5a01', false, null, 'Proveedor Otras compras Total', null);

select throws_ok(
  $$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
       imp_neto, imp_iva, imp_total, status)
    values ('jouve_fiscal', '00000000-0000-0000-0000-0000000b5f01', 'factura', 'A', 8, 1,
            current_date, 1000, 210, 1500, 'received')$$,
  '23514',
  'Los importes no suman el total: neto + IVA + otros tributos + no gravado + exento tienen que dar el total del comprobante.',
  'a fiscal purchase whose parts do not add up to its total is refused'
);

select throws_ok(
  $$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
       imp_neto, imp_iva, imp_trib, imp_perc_iibb, imp_no_gravado, imp_op_exentas, imp_total, status)
    values ('jouve_fiscal', '00000000-0000-0000-0000-0000000b5f01', 'factura', 'A', 8, 2,
            current_date, 1000, 210, 30, 30, 250, 10, 1500.01, 'received')$$,
  '23514',
  null,
  'a cent between the parts and the total is refused (20261104120500: it stayed in proveedores)'
);

select lives_ok(
  $$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
       imp_neto, imp_iva, imp_trib, imp_perc_iibb, imp_no_gravado, imp_op_exentas, imp_total, status)
    values ('jouve_fiscal', '00000000-0000-0000-0000-0000000b5f01', 'factura', 'A', 8, 2,
            current_date, 1000, 210, 30, 30, 250, 10, 1500, 'received')$$,
  'neto + IVA + tributes + no gravado + exento equal to the total is accepted'
);

select lives_ok(
  $$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_total, status)
    values ('jouve_internal', '00000000-0000-0000-0000-0000000b5a01', 'factura', 1, 1,
            current_date, 10, 'received')$$,
  'an internal purchase is not checked here'
);

-- A row saved before the guard, with 290 of no gravado missing from its parts.
set local session_replication_role = replica;
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, status)
values ('00000000-0000-0000-0000-0000000b5c01', 'jouve_fiscal', '00000000-0000-0000-0000-0000000b5f01',
        'factura', 'A', 8, 3, current_date, 1000, 210, 1500, 'received');
set local session_replication_role = origin;

select lives_ok(
  $$update public.purchase_invoices set notes = 'revisada'
     where id = '00000000-0000-0000-0000-0000000b5c01'$$,
  'an existing row with a gap still saves an edit that leaves its amounts'
);

select lives_ok(
  $$update public.purchase_invoices set imp_neto = 1000, imp_total = 1500
     where id = '00000000-0000-0000-0000-0000000b5c01'$$,
  'rewriting the same amounts is not a change'
);

select throws_ok(
  $$update public.purchase_invoices set imp_neto = 1100
     where id = '00000000-0000-0000-0000-0000000b5c01'$$,
  '23514',
  null,
  'an amount edit that keeps a gap is refused'
);

select lives_ok(
  $$update public.purchase_invoices set imp_no_gravado = 290
     where id = '00000000-0000-0000-0000-0000000b5c01'$$,
  'moving the gap into no gravado fixes the row'
);

select is(
  (select credit from (
     select coalesce((l ->> 'credit')::numeric, 0) as credit
       from jsonb_array_elements(
              public.journal_expected_entry('purchase_invoices', '00000000-0000-0000-0000-0000000b5c01') -> 'lines') l
      where l ->> 'system_role' = 'proveedores') p),
  1500.00::numeric,
  'once fixed, the journal credits the supplier the whole total'
);

-- Letter rule (20261104120500): a fiscal B or C carries no IVA, exento or no
-- gravado, whichever writer stores it.
select throws_ok(
  $$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
       imp_neto, imp_iva, imp_total, status)
    values ('jouve_fiscal', '00000000-0000-0000-0000-0000000b5f01', 'factura', 'B', 8, 4,
            current_date, 1000, 210, 1210, 'received')$$,
  '23514',
  'En facturas B y C el IVA, el exento y el no gravado van incluidos en el neto: cargá el IVA en 0 y, si hay ítems, con «Sin alícuota».',
  'a fiscal B with IVA is refused'
);

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, status)
values ('00000000-0000-0000-0000-0000000b5c02', 'jouve_fiscal', '00000000-0000-0000-0000-0000000b5f01',
        'factura', 'B', 8, 5, current_date, 1210, 0, 1210, 'received');

select throws_ok(
  $$select public.replace_purchase_invoice_items('00000000-0000-0000-0000-0000000b5c02',
      '[{"description": "x", "quantity": 1, "unit_price": 1000, "iva_rate_id": 5,
         "line_neto": 1000, "line_iva": 210, "line_total": 1210}]'::jsonb)$$,
  '23514',
  null,
  'items cannot put IVA back on a fiscal B'
);

-- A B with IVA saved before the rule.
set local session_replication_role = replica;
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, status)
values ('00000000-0000-0000-0000-0000000b5c03', 'jouve_fiscal', '00000000-0000-0000-0000-0000000b5f01',
        'factura', 'C', 8, 6, current_date, 1000, 210, 1210, 'received');
set local session_replication_role = origin;

select lives_ok(
  $$update public.purchase_invoices set notes = 'revisada'
     where id = '00000000-0000-0000-0000-0000000b5c03'$$,
  'an old C with IVA still saves an edit that leaves its IVA'
);

select ok(
  not has_function_privilege('authenticated', 'public.guard_purchase_invoice_total()', 'execute'),
  'authenticated cannot run guard_purchase_invoice_total'
);

select * from finish();
rollback;
