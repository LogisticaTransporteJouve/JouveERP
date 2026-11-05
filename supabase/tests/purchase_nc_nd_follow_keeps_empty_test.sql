-- «Modificar» a factura's center or account keeps the other field of an NC/ND
-- that follows it empty when it was left empty on purpose (20261104194200),
-- as «Recategorizar» does: the inherit trigger no longer refills it from the
-- factura. 1986 has no seed data. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select plan(4);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000001942e1', 'finance@nc-follow-empty.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000001942e1', 'finance');

insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000001942b1', '30777777778', 'Proveedor NC vacía sigue factura', 'responsable_inscripto');
insert into public.chart_of_accounts (id, code, name, level, account_type) values
  ('00000000-0000-0000-0000-0000001942a1', '19421', 'Gasto viejo NCV', 1, 'resultado_negativo'),
  ('00000000-0000-0000-0000-0000001942a2', '19422', 'Gasto nuevo NCV', 1, 'resultado_negativo');
insert into public.cost_centers (id, code, name) values
  ('00000000-0000-0000-0000-0000001942c1', 'NCV-A', 'Camión A NCV'),
  ('00000000-0000-0000-0000-0000001942c2', 'NCV-B', 'Camión B NCV');

-- Factura X (a1, c1); NC f2 and NC f3 inherit both.
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, status, account_id, cost_center_id, invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000001942f1', 'jouve_fiscal', '00000000-0000-0000-0000-0000001942b1',
   'factura', 'A', 42, 1, '1986-05-10', 1000, 210, 1210, 'received',
   '00000000-0000-0000-0000-0000001942a1', '00000000-0000-0000-0000-0000001942c1', null),
  ('00000000-0000-0000-0000-0000001942f2', 'jouve_fiscal', '00000000-0000-0000-0000-0000001942b1',
   'nc', 'A', 42, 2, '1986-05-20', 200, 42, 242, 'received',
   null, null, '00000000-0000-0000-0000-0000001942f1'),
  ('00000000-0000-0000-0000-0000001942f3', 'jouve_fiscal', '00000000-0000-0000-0000-0000001942b1',
   'nc', 'A', 42, 3, '1986-05-21', 100, 21, 121, 'received',
   null, null, '00000000-0000-0000-0000-0000001942f1');
set constraints all immediate;

-- «Recategorizar»: f2 to «Sin cuenta (Compras)», f3 to «Sin centro de costo».
create temporary table t_recat as
  select public.recategorize_expense('purchase_invoices', '00000000-0000-0000-0000-0000001942f2',
           true, false, null, null) as a,
         public.recategorize_expense('purchase_invoices', '00000000-0000-0000-0000-0000001942f3',
           false, true, null, null) as c;
set constraints all immediate;

select results_eq(
  $$select id, account_id, cost_center_id from public.purchase_invoices
     where id in ('00000000-0000-0000-0000-0000001942f2', '00000000-0000-0000-0000-0000001942f3')
     order by id$$,
  $$values ('00000000-0000-0000-0000-0000001942f2'::uuid, null::uuid, '00000000-0000-0000-0000-0000001942c1'::uuid),
           ('00000000-0000-0000-0000-0000001942f3'::uuid, '00000000-0000-0000-0000-0000001942a1'::uuid, null::uuid)$$,
  'fixture: each NC has one field emptied on purpose'
);

-- The edit form's save, as finance with its own token: X's center, then
-- X's account.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001942e1","role":"authenticated"}', true);

update public.purchase_invoices
   set cost_center_id = '00000000-0000-0000-0000-0000001942c2'
 where id = '00000000-0000-0000-0000-0000001942f1';
set constraints all immediate;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select results_eq(
  $$select account_id, cost_center_id from public.purchase_invoices
     where id = '00000000-0000-0000-0000-0000001942f2'$$,
  $$values (null::uuid, '00000000-0000-0000-0000-0000001942c2'::uuid)$$,
  'an NC with an empty account follows the factura''s new center and keeps its account empty'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001942e1","role":"authenticated"}', true);

update public.purchase_invoices
   set account_id = '00000000-0000-0000-0000-0000001942a2'
 where id = '00000000-0000-0000-0000-0000001942f1';
set constraints all immediate;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select results_eq(
  $$select account_id, cost_center_id from public.purchase_invoices
     where id = '00000000-0000-0000-0000-0000001942f3'$$,
  $$values ('00000000-0000-0000-0000-0000001942a2'::uuid, null::uuid)$$,
  'an NC with an empty center follows the factura''s new account and keeps its center empty'
);

select results_eq(
  $$select account_id, cost_center_id from public.purchase_invoices
     where id = '00000000-0000-0000-0000-0000001942f2'$$,
  $$values (null::uuid, '00000000-0000-0000-0000-0000001942c2'::uuid)$$,
  'and the NC with an empty account, which no longer carries the old account, is left alone'
);

select * from finish();
rollback;
