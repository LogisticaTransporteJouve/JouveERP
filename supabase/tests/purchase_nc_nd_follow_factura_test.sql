-- «Modificar» a factura's account or center (20261104190201): its live NC/ND
-- that still carry the replaced value follow it, field by field, as in
-- recategorize_expense; one with its own value keeps it; an annulled one
-- stays; a closed period of an NC refuses the whole edit; recategorize_expense
-- still moves them once and lists them. 1989 has no seed data. One
-- transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select plan(9);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000001903e1', 'finance@nc-follow.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000001903e1', 'finance');

insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000001903b1', '30777777778', 'Proveedor NC sigue factura', 'responsable_inscripto');
insert into public.chart_of_accounts (id, code, name, level, account_type) values
  ('00000000-0000-0000-0000-0000001903a1', '19031', 'Gasto viejo NCF', 1, 'resultado_negativo'),
  ('00000000-0000-0000-0000-0000001903a2', '19032', 'Gasto nuevo NCF', 1, 'resultado_negativo'),
  ('00000000-0000-0000-0000-0000001903a3', '19033', 'Gasto propio NCF', 1, 'resultado_negativo');
insert into public.cost_centers (id, code, name) values
  ('00000000-0000-0000-0000-0000001903c1', 'NCF-A', 'Camión A NCF'),
  ('00000000-0000-0000-0000-0000001903c2', 'NCF-B', 'Camión B NCF'),
  ('00000000-0000-0000-0000-0000001903c3', 'NCF-D', 'Centro propio NCF');

-- Factura X (a1, c1): NC f2 inherits both; ND f3 has its own center (c3);
-- NC f4 is annulled below. Factura Y (a1): its NC f6 is in a month closed
-- below.
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, status, account_id, cost_center_id, invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000001903f1', 'jouve_fiscal', '00000000-0000-0000-0000-0000001903b1',
   'factura', 'A', 19, 1, '1989-05-10', 1000, 210, 1210, 'received',
   '00000000-0000-0000-0000-0000001903a1', '00000000-0000-0000-0000-0000001903c1', null),
  ('00000000-0000-0000-0000-0000001903f2', 'jouve_fiscal', '00000000-0000-0000-0000-0000001903b1',
   'nc', 'A', 19, 2, '1989-05-20', 200, 42, 242, 'received',
   null, null, '00000000-0000-0000-0000-0000001903f1'),
  ('00000000-0000-0000-0000-0000001903f3', 'jouve_fiscal', '00000000-0000-0000-0000-0000001903b1',
   'nd', 'A', 19, 3, '1989-05-21', 50, 10.5, 60.5, 'received',
   null, '00000000-0000-0000-0000-0000001903c3', '00000000-0000-0000-0000-0000001903f1'),
  ('00000000-0000-0000-0000-0000001903f4', 'jouve_fiscal', '00000000-0000-0000-0000-0000001903b1',
   'nc', 'A', 19, 4, '1989-05-22', 30, 6.3, 36.3, 'received',
   null, null, '00000000-0000-0000-0000-0000001903f1'),
  ('00000000-0000-0000-0000-0000001903f5', 'jouve_fiscal', '00000000-0000-0000-0000-0000001903b1',
   'factura', 'A', 19, 5, '1989-05-10', 500, 105, 605, 'received',
   '00000000-0000-0000-0000-0000001903a1', null, null),
  ('00000000-0000-0000-0000-0000001903f6', 'jouve_fiscal', '00000000-0000-0000-0000-0000001903b1',
   'nc', 'A', 19, 6, '1989-06-05', 100, 21, 121, 'received',
   null, null, '00000000-0000-0000-0000-0000001903f5');
set constraints all immediate;
update public.purchase_invoices set status = 'cancelled', cancelled_at = now()
 where id = '00000000-0000-0000-0000-0000001903f4';
set constraints all immediate;

-- The edit form's save, as finance with its own token.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001903e1","role":"authenticated"}', true);

update public.purchase_invoices
   set cost_center_id = '00000000-0000-0000-0000-0000001903c2', notes = 'camión B'
 where id = '00000000-0000-0000-0000-0000001903f1';
update public.purchase_invoices
   set account_id = '00000000-0000-0000-0000-0000001903a2'
 where id = '00000000-0000-0000-0000-0000001903f1';
set constraints all immediate;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select results_eq(
  $$select account_id, cost_center_id from public.purchase_invoices
     where id = '00000000-0000-0000-0000-0000001903f2'$$,
  $$values ('00000000-0000-0000-0000-0000001903a2'::uuid, '00000000-0000-0000-0000-0000001903c2'::uuid)$$,
  'an NC that carried the factura''s center and account follows each edit'
);

select results_eq(
  $$select account_id, cost_center_id from public.purchase_invoices
     where id = '00000000-0000-0000-0000-0000001903f3'$$,
  $$values ('00000000-0000-0000-0000-0000001903a2'::uuid, '00000000-0000-0000-0000-0000001903c3'::uuid)$$,
  'an ND with its own center keeps it and follows the inherited account'
);

select results_eq(
  $$select account_id, cost_center_id from public.purchase_invoices
     where id = '00000000-0000-0000-0000-0000001903f4'$$,
  $$values ('00000000-0000-0000-0000-0000001903a1'::uuid, '00000000-0000-0000-0000-0000001903c1'::uuid)$$,
  'an annulled NC is left alone'
);

select is(
  (select cost_center_id from public.journal_entries je
    where je.source_table = 'purchase_invoices'
      and je.source_id = '00000000-0000-0000-0000-0000001903f2'
      and not je.is_reversal
      and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = je.id)),
  '00000000-0000-0000-0000-0000001903c2'::uuid,
  'the NC''s live entry is re-posted in the new center'
);

-- «Recategorizar» back: the function moves the NC/ND once and lists them.
create temporary table t_result as
  select public.recategorize_expense('purchase_invoices', '00000000-0000-0000-0000-0000001903f1',
    false, true, null, '00000000-0000-0000-0000-0000001903c1') as r;
set constraints all immediate;

select is(
  (select r -> 'adjustments' from t_result),
  '["00000000-0000-0000-0000-0000001903f2"]'::jsonb,
  'recategorize_expense still moves and lists its NC/ND'
);

select is(
  (select cost_center_id from public.purchase_invoices where id = '00000000-0000-0000-0000-0000001903f2'),
  '00000000-0000-0000-0000-0000001903c1'::uuid,
  'and the NC is back in the old center'
);

-- A closed period of an NC refuses the edit of its factura.
insert into public.accounting_closed_periods (period) values ('1989-06');

select throws_ok(
  $$update public.purchase_invoices
       set cost_center_id = '00000000-0000-0000-0000-0000001903c2'
     where id = '00000000-0000-0000-0000-0000001903f5'$$,
  '55006',
  'El período contable 1989-06 está cerrado y una NC/ND de esta factura es de ese período: su cuenta de gasto y su centro de costo siguen a la factura. Pedí que lo reabran en Contabilidad para cambiarlos',
  'an NC in a closed period refuses the edit of its factura'
);

select results_eq(
  $$select f.cost_center_id, n.cost_center_id from public.purchase_invoices f, public.purchase_invoices n
     where f.id = '00000000-0000-0000-0000-0000001903f5' and n.id = '00000000-0000-0000-0000-0000001903f6'$$,
  $$values (null::uuid, null::uuid)$$,
  'and neither the factura nor its NC change'
);

select lives_ok(
  $$update public.purchase_invoices set notes = 'solo notas'
     where id = '00000000-0000-0000-0000-0000001903f5'$$,
  'an edit that does not touch the account or center still passes'
);

select * from finish();
rollback;
