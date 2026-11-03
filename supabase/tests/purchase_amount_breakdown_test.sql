-- Exempt, non-taxed and the four tributes on a purchase (20261104090800,
-- 20261104090900): what each posts to, the legacy fill for writers that only
-- send imp_trib, the split CHECK, the closed-period guard, the items guard and
-- the libro IVA tying to the entry. One transaction, rolled back.

begin;

select plan(16);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.suppliers (id, cuit, legal_name, iva_condition, is_fiscal) values
  ('00000000-0000-0000-0000-00000000ab01', '30711111118', 'Proveedor Tributos SA', 'responsable_inscripto', true);

-- Lines of the expected entry, summed per role or account.
create temp view pab_lines as
  select (e.value ->> 'p_id')::uuid as id,
         coalesce(l ->> 'system_role', l ->> 'account_id') as target,
         sum(coalesce((l ->> 'debit')::numeric, 0)) as debit,
         sum(coalesce((l ->> 'credit')::numeric, 0)) as credit
    from (select jsonb_build_object('p_id', p.id) || public.journal_expected_entry('purchase_invoices', p.id) as value
            from public.purchase_invoices p) e,
         jsonb_array_elements(e.value -> 'lines') l
   group by 1, 2;

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_op_exentas, imp_iva, imp_perc_iva, imp_perc_iibb, imp_trib, imp_total, moneda, cotizacion)
values
  ('00000000-0000-0000-0000-00000000ab11', 'jouve_fiscal', '00000000-0000-0000-0000-00000000ab01',
   'factura', 'A', 4, 501, '2026-09-10', 100, 50, 21, 3, 2, 5, 176, 'PES', 1);

select results_eq(
  $$ select target, debit, credit from pab_lines
      where id = '00000000-0000-0000-0000-00000000ab11' order by target $$,
  $$ values ('compras', 150.00, 0.00), ('iva_credito', 21.00, 0.00),
            ('percepciones_iibb_pagadas', 2.00, 0.00), ('percepciones_iva_pagadas', 3.00, 0.00),
            ('proveedores', 0.00, 176.00) $$,
  'exento posts to the expense account and each perception to its own role'
);

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_op_exentas, imp_iva, imp_trib, imp_total, moneda, cotizacion)
values
  ('00000000-0000-0000-0000-00000000ab12', 'jouve_fiscal', '00000000-0000-0000-0000-00000000ab01',
   'factura', 'A', 4, 502, '2026-09-10', 0, 80, 0, 0, 80, 'PES', 1);

select results_eq(
  $$ select target, debit, credit from pab_lines
      where id = '00000000-0000-0000-0000-00000000ab12' order by target $$,
  $$ values ('compras', 80.00, 0.00), ('proveedores', 0.00, 80.00) $$,
  'an exempt-only purchase still posts its expense'
);

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_trib, imp_total, moneda, cotizacion)
values
  ('00000000-0000-0000-0000-00000000ab13', 'jouve_fiscal', '00000000-0000-0000-0000-00000000ab01',
   'factura', 'A', 4, 503, '2026-09-10', 100, 21, 10, 131, 'PES', 1);

select is(
  (select imp_perc_iibb from public.purchase_invoices where id = '00000000-0000-0000-0000-00000000ab13'),
  10.00::numeric,
  'a writer that only sends imp_trib gets it as IIBB'
);

update public.purchase_invoices set imp_trib = 15, imp_total = 136
 where id = '00000000-0000-0000-0000-00000000ab13';

select is(
  (select imp_perc_iibb from public.purchase_invoices where id = '00000000-0000-0000-0000-00000000ab13'),
  15.00::numeric,
  'changing only imp_trib on an IIBB-only purchase moves IIBB with it'
);

update public.purchase_invoices set imp_trib = 5, imp_total = 85
 where id = '00000000-0000-0000-0000-00000000ab12';

select is(
  (select imp_perc_iibb from public.purchase_invoices where id = '00000000-0000-0000-0000-00000000ab12'),
  5.00::numeric,
  'imp_trib going from 0 to 5 with no parts fills IIBB'
);

select throws_ok(
  $$ insert into public.purchase_invoices
       (channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
        imp_neto, imp_iva, imp_perc_iva, imp_trib, imp_total, moneda, cotizacion)
     values ('jouve_fiscal', '00000000-0000-0000-0000-00000000ab01', 'factura', 'A', 4, 504,
             '2026-09-10', 100, 21, 1, 5, 126, 'PES', 1) $$,
  '23514',
  'Los tributos no suman el total de otros tributos.',
  'a split that does not add up to imp_trib is refused with a readable message'
);

update public.purchase_invoices set imp_perc_iva = 1, imp_perc_iibb = 4
 where id = '00000000-0000-0000-0000-00000000ab11';

select results_eq(
  $$ select target, debit from pab_lines
      where id = '00000000-0000-0000-0000-00000000ab11'
        and target in ('percepciones_iva_pagadas', 'percepciones_iibb_pagadas') order by target $$,
  $$ values ('percepciones_iibb_pagadas', 4.00), ('percepciones_iva_pagadas', 1.00) $$,
  'moving an amount between perceptions changes the entry'
);

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_perc_iva, imp_trib, imp_total, moneda, cotizacion,
   invoice_origin_id, motivo_nc_nd)
values
  ('00000000-0000-0000-0000-00000000ab14', 'jouve_fiscal', '00000000-0000-0000-0000-00000000ab01',
   'nc', 'A', 4, 10, '2026-09-12', 10, 2.10, 0.30, 0.30, 12.40, 'PES', 1,
   '00000000-0000-0000-0000-00000000ab11', 'Devolución');

select results_eq(
  $$ select target, debit, credit from pab_lines
      where id = '00000000-0000-0000-0000-00000000ab14' order by target $$,
  $$ values ('compras', 0.00, 10.00), ('iva_credito', 0.00, 2.10),
            ('percepciones_iva_pagadas', 0.00, 0.30), ('proveedores', 12.40, 0.00) $$,
  'an NC mirrors the perception lines'
);

select throws_ok(
  $$ select public.replace_purchase_invoice_items('00000000-0000-0000-0000-00000000ab12',
       '[{"description":"Sin alícuota","quantity":1,"unit_price":80,"iva_rate_id":null,
          "line_neto":80,"line_iva":0,"line_total":80}]'::jsonb) $$,
  '23514',
  'Con exento o no gravado en el encabezado, los ítems deben tener alícuota.',
  'items without a rate are refused when the header carries exento'
);

select lives_ok(
  $$ select public.replace_purchase_invoice_items('00000000-0000-0000-0000-00000000ab13',
       '[{"description":"Flete","quantity":1,"unit_price":200,"iva_rate_id":5,
          "line_neto":200,"line_iva":42,"line_total":242}]'::jsonb) $$,
  'items with a rate are accepted'
);

update public.purchase_invoices set imp_op_exentas = 7
 where id = '00000000-0000-0000-0000-00000000ab13';
select public.replace_purchase_invoice_items('00000000-0000-0000-0000-00000000ab13',
  '[{"description":"Flete","quantity":1,"unit_price":200,"iva_rate_id":5,
     "line_neto":200,"line_iva":42,"line_total":242}]'::jsonb);

select is(
  (select imp_total from public.purchase_invoices where id = '00000000-0000-0000-0000-00000000ab13'),
  264.00::numeric,
  'the items total adds imp_trib and exento from the header'
);

insert into public.accounting_closed_periods (period) values ('2026-09');

select throws_ok(
  $$ update public.purchase_invoices set imp_perc_iva = 0, imp_perc_iibb = 5
      where id = '00000000-0000-0000-0000-00000000ab11' $$,
  '55006',
  null,
  'a closed period freezes the perception split'
);

select throws_ok(
  $$ update public.purchase_invoices set imp_op_exentas = 40, imp_no_gravado = 10
      where id = '00000000-0000-0000-0000-00000000ab11' $$,
  '55006',
  null,
  'a closed period freezes exento and no gravado'
);

delete from public.accounting_closed_periods where period = '2026-09';

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_perc_iva, imp_perc_iibb, imp_trib, imp_total, moneda, cotizacion)
values
  ('00000000-0000-0000-0000-00000000ab15', 'jouve_fiscal', '00000000-0000-0000-0000-00000000ab01',
   'factura', 'A', 4, 505, '2026-09-15', 100.33, 21.07, 0.01, 0.01, 0.02, 121.42, 'DOL', 1234.567);

-- 100.33, 21.07 and each 0.01 rounded on its own at 1234.567: 123864.11 + 26012.33 + 12.35 + 12.35.
select results_eq(
  $$ select (select max(imp_total) from public.libro_iva_compras('2026-09')
              where purchase_invoice_id = '00000000-0000-0000-0000-00000000ab15'),
            (select credit from pab_lines
              where id = '00000000-0000-0000-0000-00000000ab15' and target = 'proveedores') $$,
  $$ values (149901.14, 149901.14) $$,
  'a USD purchase with split tributes: the libro total and the supplier line round each part'
);

select results_eq(
  $$ select neto, exentas, imp_total from public.libro_iva_compras('2026-09')
      where purchase_invoice_id = '00000000-0000-0000-0000-00000000ab12' $$,
  $$ values (0.00, 80.00, 85.00) $$,
  'an exempt-only purchase is in the libro with its exento'
);

update public.chart_of_accounts set is_active = false where system_role = 'percepciones_iva_pagadas';

select results_eq(
  $$ select target, debit from pab_lines
      where id = '00000000-0000-0000-0000-00000000ab11' and target like 'iva_%' $$,
  $$ values ('iva_credito', 22.00) $$,
  'without an active account for the role, IVA perceptions post with the IVA credit'
);

select * from finish();
rollback;
