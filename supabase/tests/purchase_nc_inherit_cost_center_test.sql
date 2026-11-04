-- A purchase NC/ND inherits its origin's account and cost center each on its
-- own (20261104150200): an NC/ND with its own account and no center takes
-- the origin's center; one with neither takes both; one with its own center
-- keeps it; a later save that empties the center takes the origin's.
-- 1997 has no seed data. One transaction, rolled back.

begin;

select plan(5);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temporary table t_leaf as
  select e.id, row_number() over (order by e.code) as n
    from public.expense_leaf_accounts e
   order by e.code
   limit 2;

insert into public.cost_centers (id, code, name) values
  ('00000000-0000-0000-0000-0000001502c1', 'NCINH_CAMION', 'Camión NC hereda'),
  ('00000000-0000-0000-0000-0000001502c2', 'NCINH_OTRO', 'Otro centro NC hereda');
insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000001502b1', '30777777774', 'Proveedor NC hereda', 'responsable_inscripto');

-- The origin: account leaf 1, center c1.
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_total, status, account_id, cost_center_id)
values
  ('00000000-0000-0000-0000-0000001502f1', 'jouve_fiscal', '00000000-0000-0000-0000-0000001502b1',
   'factura', 'A', 15, 1, '1997-05-10', 1000, 1000, 'received',
   (select id from t_leaf where n = 1), '00000000-0000-0000-0000-0000001502c1');

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_total, status, invoice_origin_id, account_id, cost_center_id)
values
  -- Its own account, center «El del comprobante de origen».
  ('00000000-0000-0000-0000-0000001502f2', 'jouve_fiscal', '00000000-0000-0000-0000-0000001502b1',
   'nc', 'A', 15, 2, '1997-05-15', 100, 100, 'received', '00000000-0000-0000-0000-0000001502f1',
   (select id from t_leaf where n = 2), null),
  -- Neither.
  ('00000000-0000-0000-0000-0000001502f3', 'jouve_fiscal', '00000000-0000-0000-0000-0000001502b1',
   'nc', 'A', 15, 3, '1997-05-16', 100, 100, 'received', '00000000-0000-0000-0000-0000001502f1',
   null, null),
  -- Its own center.
  ('00000000-0000-0000-0000-0000001502f4', 'jouve_fiscal', '00000000-0000-0000-0000-0000001502b1',
   'nd', 'A', 15, 4, '1997-05-17', 100, 100, 'received', '00000000-0000-0000-0000-0000001502f1',
   null, '00000000-0000-0000-0000-0000001502c2');

set constraints all immediate;

select results_eq(
  $$select account_id, cost_center_id from public.purchase_invoices
     where id = '00000000-0000-0000-0000-0000001502f2'$$,
  $$select (select id from t_leaf where n = 2), '00000000-0000-0000-0000-0000001502c1'::uuid$$,
  'an NC with its own account and no center takes the origin''s center and keeps its account'
);

select results_eq(
  $$select account_id, cost_center_id from public.purchase_invoices
     where id = '00000000-0000-0000-0000-0000001502f3'$$,
  $$select (select id from t_leaf where n = 1), '00000000-0000-0000-0000-0000001502c1'::uuid$$,
  'an NC with neither takes both from the origin'
);

select results_eq(
  $$select account_id, cost_center_id from public.purchase_invoices
     where id = '00000000-0000-0000-0000-0000001502f4'$$,
  $$select (select id from t_leaf where n = 1), '00000000-0000-0000-0000-0000001502c2'::uuid$$,
  'an ND with its own center keeps it and takes the origin''s account'
);

-- A later save that empties the center takes the origin's again
-- (20261104160200: «El del comprobante de origen» on an edit).
update public.purchase_invoices
   set cost_center_id = null, notes = 'sin centro'
 where id = '00000000-0000-0000-0000-0000001502f2';

select is(
  (select cost_center_id from public.purchase_invoices
    where id = '00000000-0000-0000-0000-0000001502f2'),
  '00000000-0000-0000-0000-0000001502c1'::uuid,
  'an update that empties the center takes the origin''s'
);

select is(
  (select cost_center_id from public.purchase_invoices
    where id = '00000000-0000-0000-0000-0000001502f1'),
  '00000000-0000-0000-0000-0000001502c1'::uuid,
  'the origin is untouched'
);

select * from finish();
rollback;
