-- «Recategorizar» an NC/ND with an origin to an empty account or center saves
-- the empty value (20261104170200): the inherit trigger no longer refills
-- the origin's over what recategorize_expense set, and the answer matches the
-- row. The edit form's «La/El del comprobante de origen» still inherits.
-- 1988 has no seed data. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select plan(6);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temporary table t_leaf as
  select e.id, row_number() over (order by e.code) as n
    from public.expense_leaf_accounts e
   order by e.code
   limit 2;

insert into public.cost_centers (id, code, name) values
  ('00000000-0000-0000-0000-0000001702c1', 'RECAT_EMPTY_X', 'Centro factura X'),
  ('00000000-0000-0000-0000-0000001702c2', 'RECAT_EMPTY_D', 'Centro propio NC');
insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000001702b1', '30777777770', 'Proveedor NC a vacío', 'responsable_inscripto');

-- Factura X (leaf 1, c1); NC f2 inherits both; NC f3 has its own account
-- (leaf 2) and center (c2).
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_total, status, account_id, cost_center_id, invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000001702f1', 'jouve_fiscal', '00000000-0000-0000-0000-0000001702b1',
   'factura', 'A', 17, 1, '1988-04-05', 1000, 1000, 'received',
   (select id from t_leaf where n = 1), '00000000-0000-0000-0000-0000001702c1', null);
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_total, status, account_id, cost_center_id, invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000001702f2', 'jouve_fiscal', '00000000-0000-0000-0000-0000001702b1',
   'nc', 'A', 17, 2, '1988-04-10', 100, 100, 'received',
   null, null, '00000000-0000-0000-0000-0000001702f1'),
  ('00000000-0000-0000-0000-0000001702f3', 'jouve_fiscal', '00000000-0000-0000-0000-0000001702b1',
   'nc', 'A', 17, 3, '1988-04-11', 100, 100, 'received',
   (select id from t_leaf where n = 2), '00000000-0000-0000-0000-0000001702c2',
   '00000000-0000-0000-0000-0000001702f1');
set constraints all immediate;

-- The NC that inherited the origin's center, to «Sin centro de costo».
create temporary table t_cc as
  select public.recategorize_expense('purchase_invoices', '00000000-0000-0000-0000-0000001702f2',
    false, true, null, null) as r;
set constraints all immediate;

select is(
  (select cost_center_id from public.purchase_invoices
    where id = '00000000-0000-0000-0000-0000001702f2'),
  null::uuid,
  'an inherited center recategorized to empty stays empty'
);

select is(
  (select (r ->> 'cost_center_id')::uuid from t_cc),
  (select cost_center_id from public.purchase_invoices
    where id = '00000000-0000-0000-0000-0000001702f2'),
  'and the answer reports what the row holds'
);

-- The NC with its own account and center, both to empty.
create temporary table t_both as
  select public.recategorize_expense('purchase_invoices', '00000000-0000-0000-0000-0000001702f3',
    true, true, null, null) as r;
set constraints all immediate;

select results_eq(
  $$select account_id, cost_center_id from public.purchase_invoices
     where id = '00000000-0000-0000-0000-0000001702f3'$$,
  $$values (null::uuid, null::uuid)$$,
  'an own account and center recategorized to empty do not take the origin''s'
);

select is(
  (select (r ->> 'changed')::boolean from t_both),
  true,
  'and the change is reported'
);

-- The edit form's «El del comprobante de origen» still inherits.
update public.purchase_invoices
   set cost_center_id = null, notes = 'centro del origen'
 where id = '00000000-0000-0000-0000-0000001702f2';

select is(
  (select cost_center_id from public.purchase_invoices
    where id = '00000000-0000-0000-0000-0000001702f2'),
  '00000000-0000-0000-0000-0000001702c1'::uuid,
  'an edit that empties the center still takes the origin''s'
);

select is(
  (select cost_center_id from public.purchase_invoices
    where id = '00000000-0000-0000-0000-0000001702f1'),
  '00000000-0000-0000-0000-0000001702c1'::uuid,
  'the origin is untouched'
);

select * from finish();
rollback;
