-- Recategorizar un gasto (20261104092300): the live NC/ND of a purchase
-- that still carry the replaced account or center follow it, field by
-- field; one with its own value keeps it; an annulled one stays; the NC's
-- entry is re-posted with the new account; a closed period of an NC refuses
-- the whole change. One transaction, rolled back.

begin;

select plan(7);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- The live entry's credit on one account for a purchase.
create function pg_temp.credit_on(p_id uuid, p_account uuid) returns numeric
language sql as $$
  select coalesce(sum(l.credit), 0) from public.journal_entries je
    join public.journal_entry_lines l on l.journal_entry_id = je.id
   where je.source_table = 'purchase_invoices' and je.source_id = p_id and not je.is_reversal
     and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = je.id)
     and l.chart_of_accounts_id = p_account;
$$;

insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000009230b1', '30777777778', 'Proveedor NC Recategorizar', 'responsable_inscripto');
insert into public.chart_of_accounts (id, code, name, level, account_type) values
  ('00000000-0000-0000-0000-0000009230a1', '9231', 'Gasto viejo NC', 1, 'resultado_negativo'),
  ('00000000-0000-0000-0000-0000009230a2', '9232', 'Gasto nuevo NC', 1, 'resultado_negativo'),
  ('00000000-0000-0000-0000-0000009230a3', '9233', 'Gasto propio NC', 1, 'resultado_negativo');
insert into public.cost_centers (id, code, name) values
  ('00000000-0000-0000-0000-0000009230c1', 'RNC-VIEJO', 'Centro viejo NC'),
  ('00000000-0000-0000-0000-0000009230c2', 'RNC-NUEVO', 'Centro nuevo NC'),
  ('00000000-0000-0000-0000-0000009230c3', 'RNC-PROPIO', 'Centro propio ND');

-- A factura, an NC that inherits it, an ND with its own account and center, an NC
-- annulled below; and a second factura whose NC is in a closed period.
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, status, account_id, cost_center_id, invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000009230f1', 'jouve_fiscal', '00000000-0000-0000-0000-0000009230b1',
   'factura', 'A', 23, 1, '1992-05-10', 1000, 210, 1210, 'received',
   '00000000-0000-0000-0000-0000009230a1', '00000000-0000-0000-0000-0000009230c1', null),
  ('00000000-0000-0000-0000-0000009230f2', 'jouve_fiscal', '00000000-0000-0000-0000-0000009230b1',
   'nc', 'A', 23, 2, '1992-05-20', 200, 42, 242, 'received',
   null, null, '00000000-0000-0000-0000-0000009230f1'),
  ('00000000-0000-0000-0000-0000009230f3', 'jouve_fiscal', '00000000-0000-0000-0000-0000009230b1',
   'nd', 'A', 23, 3, '1992-05-21', 50, 10.5, 60.5, 'received',
   '00000000-0000-0000-0000-0000009230a3', '00000000-0000-0000-0000-0000009230c3', '00000000-0000-0000-0000-0000009230f1'),
  ('00000000-0000-0000-0000-0000009230f4', 'jouve_fiscal', '00000000-0000-0000-0000-0000009230b1',
   'nc', 'A', 23, 4, '1992-05-22', 30, 6.3, 36.3, 'received',
   null, null, '00000000-0000-0000-0000-0000009230f1'),
  ('00000000-0000-0000-0000-0000009230f5', 'jouve_fiscal', '00000000-0000-0000-0000-0000009230b1',
   'factura', 'A', 23, 5, '1992-05-10', 500, 105, 605, 'received',
   '00000000-0000-0000-0000-0000009230a1', null, null),
  ('00000000-0000-0000-0000-0000009230f6', 'jouve_fiscal', '00000000-0000-0000-0000-0000009230b1',
   'nc', 'A', 23, 6, '1992-06-05', 100, 21, 121, 'received',
   null, null, '00000000-0000-0000-0000-0000009230f5');
set constraints all immediate;
update public.purchase_invoices set status = 'cancelled', cancelled_at = now()
 where id = '00000000-0000-0000-0000-0000009230f4';
set constraints all immediate;

create temporary table t_result as
  select public.recategorize_expense('purchase_invoices', '00000000-0000-0000-0000-0000009230f1',
    true, true, '00000000-0000-0000-0000-0000009230a2', '00000000-0000-0000-0000-0000009230c2') as r;
set constraints all immediate;

select results_eq(
  $$select account_id, cost_center_id from public.purchase_invoices
     where id = '00000000-0000-0000-0000-0000009230f2'$$,
  $$values ('00000000-0000-0000-0000-0000009230a2'::uuid, '00000000-0000-0000-0000-0000009230c2'::uuid)$$,
  'an NC that carried the purchase''s account and center follows it'
);

select results_eq(
  $$select account_id, cost_center_id from public.purchase_invoices
     where id = '00000000-0000-0000-0000-0000009230f3'$$,
  $$values ('00000000-0000-0000-0000-0000009230a3'::uuid, '00000000-0000-0000-0000-0000009230c3'::uuid)$$,
  'an ND with its own account and center keeps them'
);

select results_eq(
  $$select account_id, cost_center_id from public.purchase_invoices
     where id = '00000000-0000-0000-0000-0000009230f4'$$,
  $$values ('00000000-0000-0000-0000-0000009230a1'::uuid, '00000000-0000-0000-0000-0000009230c1'::uuid)$$,
  'an annulled NC is left alone'
);

select is(
  pg_temp.credit_on('00000000-0000-0000-0000-0000009230f2', '00000000-0000-0000-0000-0000009230a2'),
  200::numeric,
  'the NC''s entry now reverses the new account'
);

select is(
  (select r -> 'adjustments' from t_result),
  '["00000000-0000-0000-0000-0000009230f2"]'::jsonb,
  'the answer lists the NC/ND that followed'
);

-- A closed period of an NC refuses the change of its purchase.
insert into public.accounting_closed_periods (period) values ('1992-06');

select throws_ok(
  $$select public.recategorize_expense('purchase_invoices', '00000000-0000-0000-0000-0000009230f5',
      true, false, '00000000-0000-0000-0000-0000009230a2', null)$$,
  '55006',
  null,
  'an NC in a closed period refuses the change'
);

select is(
  (select account_id from public.purchase_invoices where id = '00000000-0000-0000-0000-0000009230f5'),
  '00000000-0000-0000-0000-0000009230a1'::uuid,
  'and the purchase keeps its account'
);

select * from finish();
rollback;
