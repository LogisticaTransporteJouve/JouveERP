-- A supplier's CUIT is printed by the Libro IVA Compras: it cannot change
-- while the supplier has a fiscal purchase in a closed period
-- (20261104140101). One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select plan(5);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.suppliers (id, cuit, legal_name, iva_condition, is_fiscal) values
  ('00000000-0000-0000-0000-0000000c3d01', '30733333335', 'Proveedor CUIT Cerrado SA', 'responsable_inscripto', true),
  ('00000000-0000-0000-0000-0000000c3d02', '30733333336', 'Proveedor Sin Compras SA', 'responsable_inscripto', true);

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, moneda, cotizacion)
values
  ('00000000-0000-0000-0000-0000000c3d11', 'jouve_fiscal', '00000000-0000-0000-0000-0000000c3d01',
   'factura', 'A', 9, 703, '2026-08-10', 100, 21, 121, 'PES', 1);
set constraints all immediate;

insert into public.accounting_closed_periods (period) values ('2026-08');

select throws_ok(
  $$ update public.suppliers set cuit = '30733333337'
      where id = '00000000-0000-0000-0000-0000000c3d01' $$,
  '55006',
  'El proveedor tiene compras en un período contable cerrado: su CUIT figura en el Libro IVA Compras y no se puede cambiar.',
  'a CUIT printed in a closed book cannot change'
);

select lives_ok(
  $$ update public.suppliers set legal_name = 'Proveedor CUIT Cerrado SRL', cuit = '30733333335'
      where id = '00000000-0000-0000-0000-0000000c3d01' $$,
  'other fields, and re-sending the same CUIT, still save'
);

select lives_ok(
  $$ update public.suppliers set cuit = '30733333338'
      where id = '00000000-0000-0000-0000-0000000c3d02' $$,
  'a supplier with no closed-period purchase changes its CUIT'
);

delete from public.accounting_closed_periods where period = '2026-08';

select lives_ok(
  $$ update public.suppliers set cuit = '30733333337'
      where id = '00000000-0000-0000-0000-0000000c3d01' $$,
  'once the period is open again the CUIT can change'
);

select is(
  (select cuit from public.suppliers where id = '00000000-0000-0000-0000-0000000c3d01'),
  '30733333337',
  'and it is saved'
);

select * from finish();
rollback;
