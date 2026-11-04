-- A purchase NC/ND without expense account takes its origin's account and
-- cost center; one set on the NC/ND is kept. One transaction, rolled back.

begin;

select plan(7);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Case 5 needs an NC left empty while its factura gets an account, as a row
-- from before 20261104190201 (which moves it along) is.
alter table public.purchase_invoices disable trigger purchase_invoices_nc_nd_follow_factura;

insert into public.suppliers (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000851f1', true, '30999999994', 'Proveedor NC Cuenta', 'responsable_inscripto');
insert into public.chart_of_accounts (id, code, name, level, account_type) values
  ('00000000-0000-0000-0000-0000000851a1', '95', 'Gasto origen', 1, 'resultado_negativo'),
  ('00000000-0000-0000-0000-0000000851a2', '96', 'Gasto propio', 1, 'resultado_negativo');
insert into public.cost_centers (id, code, name) values
  ('00000000-0000-0000-0000-0000000851cc', 'CC-NC', 'Centro NC');

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, status, account_id, cost_center_id)
values
  ('00000000-0000-0000-0000-0000000851b1', 'jouve_fiscal', '00000000-0000-0000-0000-0000000851f1',
   'factura', 'A', 8, 1, current_date, 1000, 210, 1210, 'received',
   '00000000-0000-0000-0000-0000000851a1', '00000000-0000-0000-0000-0000000851cc');

-- 1. An NC without account inherits the origin's account and cost center.
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, status, invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000000851b2', 'jouve_fiscal', '00000000-0000-0000-0000-0000000851f1',
   'nc', 'A', 8, 2, current_date, 100, 21, 121, 'received',
   '00000000-0000-0000-0000-0000000851b1');

select is(
  (select account_id from public.purchase_invoices
    where id = '00000000-0000-0000-0000-0000000851b2'),
  '00000000-0000-0000-0000-0000000851a1'::uuid,
  'an NC without account takes its origin''s account');
select is(
  (select cost_center_id from public.purchase_invoices
    where id = '00000000-0000-0000-0000-0000000851b2'),
  '00000000-0000-0000-0000-0000000851cc'::uuid,
  'an NC without cost center takes its origin''s cost center');

-- 2. Its entry reverses the origin's expense account, not "compras".
select lives_ok('set constraints all immediate', 'the purchases post');
select ok(
  exists (
    select 1
      from public.journal_entries je
      join public.journal_entry_lines l on l.journal_entry_id = je.id
     where je.source_table = 'purchase_invoices'
       and je.source_id = '00000000-0000-0000-0000-0000000851b2'
       and not je.is_reversal
       and l.chart_of_accounts_id = '00000000-0000-0000-0000-0000000851a1'
       and l.credit = 100),
  'the NC credits the origin''s expense account');

-- 3. An account set on the NC is kept.
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, status, invoice_origin_id, account_id)
values
  ('00000000-0000-0000-0000-0000000851b3', 'jouve_fiscal', '00000000-0000-0000-0000-0000000851f1',
   'nc', 'A', 8, 3, current_date, 100, 21, 121, 'received',
   '00000000-0000-0000-0000-0000000851b1', '00000000-0000-0000-0000-0000000851a2');

select is(
  (select account_id from public.purchase_invoices
    where id = '00000000-0000-0000-0000-0000000851b3'),
  '00000000-0000-0000-0000-0000000851a2'::uuid,
  'an account set on the NC is not overwritten');

-- 4. A factura without account keeps none.
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, status)
values
  ('00000000-0000-0000-0000-0000000851b4', 'jouve_fiscal', '00000000-0000-0000-0000-0000000851f1',
   'factura', 'A', 8, 4, current_date, 100, 21, 121, 'received');

select is(
  (select account_id from public.purchase_invoices
    where id = '00000000-0000-0000-0000-0000000851b4'),
  null,
  'a factura without account stays without one');

-- 5. A save that re-sends the same origin fills an account still empty from
--    the origin while the period is open (20261104160200).
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, status, invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000000851b5', 'jouve_fiscal', '00000000-0000-0000-0000-0000000851f1',
   'nc', 'A', 8, 5, current_date, 10, 2.1, 12.1, 'received',
   '00000000-0000-0000-0000-0000000851b4');
update public.purchase_invoices set account_id = '00000000-0000-0000-0000-0000000851a2'
 where id = '00000000-0000-0000-0000-0000000851b4';
update public.purchase_invoices
   set notes = 'solo notas', invoice_origin_id = '00000000-0000-0000-0000-0000000851b4'
 where id = '00000000-0000-0000-0000-0000000851b5';

select is(
  (select account_id from public.purchase_invoices
    where id = '00000000-0000-0000-0000-0000000851b5'),
  '00000000-0000-0000-0000-0000000851a2'::uuid,
  'saving an NC with the same origin in an open period takes the origin''s account');

select * from finish();
rollback;
