-- Perceptions and payments on account of Ganancias and other national taxes
-- on a purchase (20261104113001, 20261104113002): a fifth part of imp_trib
-- that posts to percepciones_ganancias (never IVA), counts once in the total
-- guard, shows in the libro and is frozen by a closed period. One
-- transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select plan(13);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.suppliers (id, cuit, legal_name, iva_condition, is_fiscal) values
  ('00000000-0000-0000-0000-00000000ac01', '30722222227', 'Proveedor Ganancias SA', 'responsable_inscripto', true);

create temp view ppn_lines as
  select (e.value ->> 'p_id')::uuid as id,
         coalesce(l ->> 'system_role', l ->> 'account_id') as target,
         sum(coalesce((l ->> 'debit')::numeric, 0)) as debit,
         sum(coalesce((l ->> 'credit')::numeric, 0)) as credit
    from (select jsonb_build_object('p_id', p.id) || public.journal_expected_entry('purchase_invoices', p.id) as value
            from public.purchase_invoices p) e,
         jsonb_array_elements(e.value -> 'lines') l
   group by 1, 2;

select is(
  (select count(*)::int from public.chart_of_accounts
    where system_role = 'percepciones_ganancias' and is_active and account_type = 'activo'
      and code like '1.1.3.%'),
  1,
  'an active asset account under 1.1.3 holds the role percepciones_ganancias'
);

-- 1000 + 210 IVA + 30 IVA perception + 20 IIBB + 40 Ganancias = 1300.
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_perc_iva, imp_perc_iibb, imp_perc_nacionales, imp_trib, imp_total,
   moneda, cotizacion)
values
  ('00000000-0000-0000-0000-00000000ac11', 'jouve_fiscal', '00000000-0000-0000-0000-00000000ac01',
   'factura', 'A', 7, 701, '2026-09-10', 1000, 210, 30, 20, 40, 90, 1300, 'PES', 1);

select results_eq(
  $$ select target, debit, credit from ppn_lines
      where id = '00000000-0000-0000-0000-00000000ac11' order by target $$,
  $$ values ('compras', 1000.00, 0.00), ('iva_credito', 210.00, 0.00),
            ('percepciones_ganancias', 40.00, 0.00), ('percepciones_iibb_pagadas', 20.00, 0.00),
            ('percepciones_iva_pagadas', 30.00, 0.00), ('proveedores', 0.00, 1300.00) $$,
  'Ganancias posts to its own asset role, not to IVA nor to the expense'
);

select results_eq(
  $$ select perc_nacionales, perc_nacionales_orig, imp_trib, imp_total
       from public.libro_iva_compras('2026-09')
      where purchase_invoice_id = '00000000-0000-0000-0000-00000000ac11' $$,
  $$ values (40.00, 40.00, 90.00, 1300.00) $$,
  'the libro returns the Ganancias part, inside trib, and its total ties to the supplier line'
);

select results_eq(
  $$ select iva from public.libro_iva_compras('2026-09')
      where purchase_invoice_id = '00000000-0000-0000-0000-00000000ac11' $$,
  $$ values (210.00) $$,
  'the libro IVA column carries only the IVA'
);

select throws_ok(
  $$ insert into public.purchase_invoices
       (channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
        imp_neto, imp_iva, imp_perc_nacionales, imp_trib, imp_total, moneda, cotizacion)
     values ('jouve_fiscal', '00000000-0000-0000-0000-00000000ac01', 'factura', 'A', 7, 702,
             '2026-09-10', 100, 21, 3, 5, 126, 'PES', 1) $$,
  '23514',
  'Los tributos no suman el total de otros tributos.',
  'a split whose Ganancias part does not add up to imp_trib is refused'
);

select throws_ok(
  $$ insert into public.purchase_invoices
       (channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
        imp_neto, imp_iva, imp_perc_nacionales, imp_trib, imp_total, moneda, cotizacion)
     values ('jouve_fiscal', '00000000-0000-0000-0000-00000000ac01', 'factura', 'A', 7, 703,
             '2026-09-10', 100, 21, 5, 5, 131, 'PES', 1) $$,
  '23514',
  'Los importes no suman el total: neto + IVA + otros tributos + no gravado + exento tienen que dar el total del comprobante.',
  'the total guard counts the Ganancias part once, through imp_trib'
);

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_perc_nacionales, imp_trib, imp_total, moneda, cotizacion)
values
  ('00000000-0000-0000-0000-00000000ac12', 'jouve_fiscal', '00000000-0000-0000-0000-00000000ac01',
   'factura', 'A', 7, 704, '2026-09-11', 100, 21, 5, 5, 126, 'PES', 1);

select is(
  (select imp_perc_iibb from public.purchase_invoices where id = '00000000-0000-0000-0000-00000000ac12'),
  0.00::numeric,
  'a split with only the Ganancias part is not moved to IIBB by the legacy fill'
);

select throws_ok(
  $$ update public.purchase_invoices set imp_trib = 8, imp_total = 129
      where id = '00000000-0000-0000-0000-00000000ac12' $$,
  '23514',
  'Los tributos no suman el total de otros tributos.',
  'changing only imp_trib on a purchase with a Ganancias part is refused, not moved to IIBB'
);

update public.purchase_invoices set imp_perc_nacionales = 2, imp_perc_iibb = 3
 where id = '00000000-0000-0000-0000-00000000ac12';

select results_eq(
  $$ select target, debit from ppn_lines
      where id = '00000000-0000-0000-0000-00000000ac12'
        and target in ('percepciones_ganancias', 'percepciones_iibb_pagadas') order by target $$,
  $$ values ('percepciones_ganancias', 2.00), ('percepciones_iibb_pagadas', 3.00) $$,
  'moving an amount between Ganancias and IIBB changes the entry'
);

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_perc_nacionales, imp_trib, imp_total, moneda, cotizacion,
   invoice_origin_id, motivo_nc_nd)
values
  ('00000000-0000-0000-0000-00000000ac13', 'jouve_fiscal', '00000000-0000-0000-0000-00000000ac01',
   'nc', 'A', 7, 11, '2026-09-12', 10, 2.10, 0.40, 0.40, 12.50, 'PES', 1,
   '00000000-0000-0000-0000-00000000ac11', 'Devolución');

select results_eq(
  $$ select target, debit, credit from ppn_lines
      where id = '00000000-0000-0000-0000-00000000ac13' order by target $$,
  $$ values ('compras', 0.00, 10.00), ('iva_credito', 0.00, 2.10),
            ('percepciones_ganancias', 0.00, 0.40), ('proveedores', 12.50, 0.00) $$,
  'an NC mirrors the Ganancias line'
);

insert into public.employees (id, legal_name, pay_frequency, base_salary, hire_date) values
  ('00000000-0000-0000-0000-00000000ac21', 'Empleado Ganancias', 'mensual', 1000, '2026-01-01');
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_perc_nacionales, imp_trib, imp_total, moneda, cotizacion,
   charged_employee_id)
values
  ('00000000-0000-0000-0000-00000000ac14', 'jouve_fiscal', '00000000-0000-0000-0000-00000000ac01',
   'factura', 'A', 7, 705, '2026-09-13', 100, 21, 6, 6, 127, 'PES', 1,
   '00000000-0000-0000-0000-00000000ac21');

select is(
  (select amount from public.employee_account_movements
    where purchase_invoice_id = '00000000-0000-0000-0000-00000000ac14'),
  100.00::numeric,
  'the employee is not charged the Ganancias part: it is the company''s credit'
);

insert into public.accounting_closed_periods (period) values ('2026-09');

select throws_ok(
  $$ update public.purchase_invoices set imp_perc_nacionales = 0, imp_perc_iibb = 60
      where id = '00000000-0000-0000-0000-00000000ac11' $$,
  '55006',
  null,
  'a closed period freezes the Ganancias part'
);

delete from public.accounting_closed_periods where period = '2026-09';

update public.chart_of_accounts set is_active = false where system_role = 'percepciones_ganancias';

select results_eq(
  $$ select target, debit from ppn_lines
      where id = '00000000-0000-0000-0000-00000000ac11'
        and target in ('percepciones_ganancias', 'percepciones_iibb_pagadas', 'iva_credito')
      order by target $$,
  $$ values ('iva_credito', 210.00), ('percepciones_iibb_pagadas', 60.00) $$,
  'without an active account for the role, Ganancias posts with the IIBB perceptions, never with IVA'
);

select * from finish();
rollback;
