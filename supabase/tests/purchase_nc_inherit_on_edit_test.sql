-- An edited purchase NC/ND follows its origin (20261104160200): moving it to
-- another factura moves what it inherited from the old one and keeps what
-- the user set; emptying a field on an edit takes the origin's; a factura
-- turned into an NC takes the origin's for an empty field; a field already
-- empty in a closed period stays so, and a notes-only save still passes.
-- 1994 has no seed data. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select plan(8);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- NC f8 must stay empty while factura Z gets an account, as a row from before
-- 20261104190201 (which moves it along) does.
alter table public.purchase_invoices disable trigger purchase_invoices_nc_nd_follow_factura;

create temporary table t_leaf as
  select e.id, row_number() over (order by e.code) as n
    from public.expense_leaf_accounts e
   order by e.code
   limit 3;

insert into public.cost_centers (id, code, name) values
  ('00000000-0000-0000-0000-0000001602c1', 'NCEDIT_X', 'Centro factura X'),
  ('00000000-0000-0000-0000-0000001602c2', 'NCEDIT_Y', 'Centro factura Y'),
  ('00000000-0000-0000-0000-0000001602c3', 'NCEDIT_PROPIO', 'Centro propio NC');
insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000001602b1', '30777777775', 'Proveedor NC editada', 'responsable_inscripto');

-- Factura X (leaf 1, c1), factura Y (leaf 2, c2), factura Z (no account, no
-- center yet); NC f4 inherits X; NC f5 has its own account (leaf 3) and X's
-- center; NC f6 inherits X; f7 is a factura with only center c3; NC f8 of Z
-- inherits nothing.
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_total, status, account_id, cost_center_id)
values
  ('00000000-0000-0000-0000-0000001602f1', 'jouve_fiscal', '00000000-0000-0000-0000-0000001602b1',
   'factura', 'A', 16, 1, '1994-04-05', 1000, 1000, 'received',
   (select id from t_leaf where n = 1), '00000000-0000-0000-0000-0000001602c1'),
  ('00000000-0000-0000-0000-0000001602f2', 'jouve_fiscal', '00000000-0000-0000-0000-0000001602b1',
   'factura', 'A', 16, 2, '1994-04-06', 1000, 1000, 'received',
   (select id from t_leaf where n = 2), '00000000-0000-0000-0000-0000001602c2'),
  ('00000000-0000-0000-0000-0000001602f3', 'jouve_fiscal', '00000000-0000-0000-0000-0000001602b1',
   'factura', 'A', 16, 3, '1994-04-07', 1000, 1000, 'received', null, null),
  ('00000000-0000-0000-0000-0000001602f7', 'jouve_fiscal', '00000000-0000-0000-0000-0000001602b1',
   'factura', 'A', 16, 7, '1994-04-12', 100, 100, 'received',
   null, '00000000-0000-0000-0000-0000001602c3');

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_total, status, invoice_origin_id, account_id, cost_center_id)
values
  ('00000000-0000-0000-0000-0000001602f4', 'jouve_fiscal', '00000000-0000-0000-0000-0000001602b1',
   'nc', 'A', 16, 4, '1994-04-10', 100, 100, 'received', '00000000-0000-0000-0000-0000001602f1',
   null, null),
  ('00000000-0000-0000-0000-0000001602f5', 'jouve_fiscal', '00000000-0000-0000-0000-0000001602b1',
   'nc', 'A', 16, 5, '1994-04-10', 100, 100, 'received', '00000000-0000-0000-0000-0000001602f1',
   (select id from t_leaf where n = 3), null),
  ('00000000-0000-0000-0000-0000001602f6', 'jouve_fiscal', '00000000-0000-0000-0000-0000001602b1',
   'nc', 'A', 16, 6, '1994-04-11', 100, 100, 'received', '00000000-0000-0000-0000-0000001602f1',
   null, null),
  ('00000000-0000-0000-0000-0000001602f8', 'jouve_fiscal', '00000000-0000-0000-0000-0000001602b1',
   'nc', 'A', 16, 8, '1994-04-13', 100, 100, 'received', '00000000-0000-0000-0000-0000001602f3',
   null, null);

-- The edit form re-sends the stored account and center with the new origin.
update public.purchase_invoices
   set invoice_origin_id = '00000000-0000-0000-0000-0000001602f2',
       account_id = (select id from t_leaf where n = 1),
       cost_center_id = '00000000-0000-0000-0000-0000001602c1'
 where id = '00000000-0000-0000-0000-0000001602f4';

select results_eq(
  $$select account_id, cost_center_id from public.purchase_invoices
     where id = '00000000-0000-0000-0000-0000001602f4'$$,
  $$select (select id from t_leaf where n = 2), '00000000-0000-0000-0000-0000001602c2'::uuid$$,
  'an NC moved to another factura takes the new origin''s account and center'
);

update public.purchase_invoices
   set invoice_origin_id = '00000000-0000-0000-0000-0000001602f2',
       account_id = (select id from t_leaf where n = 3),
       cost_center_id = '00000000-0000-0000-0000-0000001602c1'
 where id = '00000000-0000-0000-0000-0000001602f5';

select results_eq(
  $$select account_id, cost_center_id from public.purchase_invoices
     where id = '00000000-0000-0000-0000-0000001602f5'$$,
  $$select (select id from t_leaf where n = 3), '00000000-0000-0000-0000-0000001602c2'::uuid$$,
  'its own account stays and the inherited center follows the new origin'
);

-- Moved, with a center picked in the same save.
update public.purchase_invoices
   set invoice_origin_id = '00000000-0000-0000-0000-0000001602f2',
       account_id = (select id from t_leaf where n = 1),
       cost_center_id = '00000000-0000-0000-0000-0000001602c3'
 where id = '00000000-0000-0000-0000-0000001602f6';

select results_eq(
  $$select account_id, cost_center_id from public.purchase_invoices
     where id = '00000000-0000-0000-0000-0000001602f6'$$,
  $$select (select id from t_leaf where n = 2), '00000000-0000-0000-0000-0000001602c3'::uuid$$,
  'a center picked in the same save is kept'
);

-- «La del comprobante de origen» picked on an edit that keeps the origin.
update public.purchase_invoices
   set account_id = null, notes = 'cuenta del origen'
 where id = '00000000-0000-0000-0000-0000001602f5';

select is(
  (select account_id from public.purchase_invoices
    where id = '00000000-0000-0000-0000-0000001602f5'),
  (select id from t_leaf where n = 2),
  'emptying the account on an edit takes the origin''s'
);

-- A factura turned into an NC of Y: the empty account takes Y's, the center
-- set on it stays.
update public.purchase_invoices
   set kind = 'nc', invoice_origin_id = '00000000-0000-0000-0000-0000001602f2'
 where id = '00000000-0000-0000-0000-0000001602f7';

select results_eq(
  $$select account_id, cost_center_id from public.purchase_invoices
     where id = '00000000-0000-0000-0000-0000001602f7'$$,
  $$select (select id from t_leaf where n = 2), '00000000-0000-0000-0000-0000001602c3'::uuid$$,
  'a factura turned into an NC takes the origin''s account for an empty one'
);

-- Z gets an account later; then April closes. NC f8, still without one, is
-- saved with only its notes changed.
update public.purchase_invoices
   set account_id = (select id from t_leaf where n = 1)
 where id = '00000000-0000-0000-0000-0000001602f3';
set constraints all immediate;
insert into public.accounting_closed_periods (period) values ('1994-04');

select lives_ok(
  $$update public.purchase_invoices
       set notes = 'solo notas', account_id = null,
           invoice_origin_id = '00000000-0000-0000-0000-0000001602f3'
     where id = '00000000-0000-0000-0000-0000001602f8';
    set constraints all immediate$$,
  'a notes-only save of an NC in a closed period still passes'
);

select is(
  (select account_id from public.purchase_invoices
    where id = '00000000-0000-0000-0000-0000001602f8'),
  null::uuid,
  'and its account, empty before, stays empty there'
);

select is(
  (select account_id from public.purchase_invoices
    where id = '00000000-0000-0000-0000-0000001602f1'),
  (select id from t_leaf where n = 1),
  'the origins are untouched'
);

select * from finish();
rollback;
