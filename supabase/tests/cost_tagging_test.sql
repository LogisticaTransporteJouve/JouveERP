-- Roadmap 1.1 + 1.2 + 1.8 (20261103010000): a cost carries its expense
-- account and cost center. Only a postable expense leaf is accepted on a
-- purchase, a supplier default or a manual expense; a manual expense debits
-- its account instead of 'gastos' (re-posting when it changes), a movement
-- owned by a document or an income takes none, and the management P&L
-- returns each row's cost center. One transaction, rolled back.

begin;

select plan(13);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Two postable leaves that gestión counts (not neutral) and one parent
-- expense account of the seeded chart.
create temp table leaf as
select e.id, row_number() over (order by e.code) as n
  from public.expense_leaf_accounts e
 where not exists (select 1 from public.management_buckets mb
                    where mb.chart_of_accounts_id = e.id and mb.bucket = 'neutral')
 order by e.code
 limit 2;
create temp table parent as
select c.id
  from public.chart_of_accounts c
 where c.account_type = 'resultado_negativo' and c.is_active
   and exists (select 1 from public.chart_of_accounts ch where ch.parent_id = c.id and ch.is_active)
 limit 1;

insert into public.cost_centers (id, code, name) values
  ('00000000-0000-0000-0000-0000001103c1', 'CAMION_TEST', 'Camión test');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000001103a1', 'Caja Costos', 'cash', 'ARS');
insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000001103b1', '30777777778', 'Proveedor Costos', 'responsable_inscripto');

-- Purchases and supplier defaults -----------------------------------------------

select throws_ok(
  format($$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, imp_neto, imp_total, status, account_id)
    values ('jouve_fiscal', '00000000-0000-0000-0000-0000001103b1', 'factura', 'A', 1, 110301,
            '1993-05-10', 100, 100, 'received', %L)$$, (select id from parent)),
  '23514',
  null,
  'a purchase cannot post to a parent account'
);

select lives_ok(
  format($$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, imp_neto, imp_total, status,
       account_id, cost_center_id)
    values ('jouve_fiscal', '00000000-0000-0000-0000-0000001103b1', 'factura', 'A', 1, 110302,
            '1993-05-10', 100, 100, 'received', %L, '00000000-0000-0000-0000-0000001103c1')$$,
    (select id from leaf where n = 1)),
  'a purchase takes a postable leaf and a cost center'
);

select throws_ok(
  format($$update public.suppliers set default_expense_account_id = %L
     where id = '00000000-0000-0000-0000-0000001103b1'$$, (select id from parent)),
  '23514',
  null,
  'a supplier default must be a postable leaf too'
);

select lives_ok(
  format($$update public.suppliers
      set default_expense_account_id = %L, default_cost_center_id = '00000000-0000-0000-0000-0000001103c1'
     where id = '00000000-0000-0000-0000-0000001103b1'$$, (select id from leaf where n = 1)),
  'a supplier keeps a default account and cost center'
);

-- Manual expenses ------------------------------------------------------------------

insert into public.transactions
  (id, account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description,
   expense_account_id, cost_center_id)
values
  ('00000000-0000-0000-0000-0000001103e1', '00000000-0000-0000-0000-0000001103a1', 'jouve_fiscal',
   'expense', 50, 'ARS', '1993-05-10', '1993-05-01', 'Gasto con cuenta',
   (select id from leaf where n = 1), '00000000-0000-0000-0000-0000001103c1'),
  ('00000000-0000-0000-0000-0000001103e2', '00000000-0000-0000-0000-0000001103a1', 'jouve_fiscal',
   'expense', 20, 'ARS', '1993-05-10', '1993-05-01', 'Gasto sin cuenta', null, null),
  ('00000000-0000-0000-0000-0000001103e3', '00000000-0000-0000-0000-0000001103a1', 'jouve_internal',
   'expense', 30, 'ARS', '1993-05-10', '1993-05-01', 'Gasto interno con centro',
   (select id from leaf where n = 2), '00000000-0000-0000-0000-0000001103c1');

set constraints all immediate;

select results_eq(
  $$select l.chart_of_accounts_id, l.debit, je.cost_center_id
      from public.journal_entries je
      join public.journal_entry_lines l on l.journal_entry_id = je.id
     where je.source_table = 'transactions'
       and je.source_id = '00000000-0000-0000-0000-0000001103e1' and l.debit > 0$$,
  $$select id, 50.00::numeric, '00000000-0000-0000-0000-0000001103c1'::uuid from leaf where n = 1$$,
  'a manual expense debits its expense account, with its cost center'
);

select results_eq(
  $$select coa.system_role::text
      from public.journal_entries je
      join public.journal_entry_lines l on l.journal_entry_id = je.id
      join public.chart_of_accounts coa on coa.id = l.chart_of_accounts_id
     where je.source_table = 'transactions'
       and je.source_id = '00000000-0000-0000-0000-0000001103e2' and l.debit > 0$$,
  $$values ('gastos')$$,
  'without one it still debits gastos'
);

update public.transactions set expense_account_id = (select id from leaf where n = 2)
 where id = '00000000-0000-0000-0000-0000001103e1';
set constraints all immediate;

select results_eq(
  $$select l.chart_of_accounts_id
      from public.journal_entries je
      join public.journal_entry_lines l on l.journal_entry_id = je.id
     where je.source_table = 'transactions'
       and je.source_id = '00000000-0000-0000-0000-0000001103e1'
       and l.debit > 0 and not je.is_reversal$$,
  $$select id from leaf where n = 2$$,
  'changing the account re-posts the entry'
);

select is(
  public.journal_entry_status('transactions', '00000000-0000-0000-0000-0000001103e1'),
  'match',
  'and the re-posted entry matches its builder'
);

select throws_ok(
  format($$insert into public.transactions
      (account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, expense_account_id)
    values ('00000000-0000-0000-0000-0000001103a1', 'jouve_fiscal', 'income', 10, 'ARS',
            '1993-05-10', '1993-05-01', %L)$$, (select id from leaf where n = 1)),
  '23514',
  null,
  'an income takes no expense account'
);

select throws_ok(
  format($$insert into public.transactions
      (account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, is_payroll,
       expense_account_id)
    values ('00000000-0000-0000-0000-0000001103a1', 'jouve_fiscal', 'expense', 10, 'ARS',
            '1993-05-10', '1993-05-01', true, %L)$$, (select id from leaf where n = 1)),
  '23514',
  null,
  'nor does a payroll payment (its document books it)'
);

select throws_ok(
  format($$update public.transactions set expense_account_id = %L
     where id = '00000000-0000-0000-0000-0000001103e2'$$, (select id from parent)),
  '23514',
  null,
  'a manual expense cannot post to a parent account'
);

-- Management P&L by cost center ---------------------------------------------------

create temp table pnl_accrual as
select * from public.get_management_pnl('1993-05-01', '1993-05-31', 'accrual', false);
create temp table pnl_cash as
select * from public.get_management_pnl('1993-05-01', '1993-05-31', 'cash', false);

select is(
  (select sum(amount_ars) from pnl_accrual
    where cost_center_id = '00000000-0000-0000-0000-0000001103c1'),
  -180::numeric,
  'devengado: the purchase (100), the fiscal expense (50) and the internal one (30) carry the center'
);

select results_eq(
  $$select chart_account_id, sum(amount_ars) from pnl_cash
     where cost_center_id = '00000000-0000-0000-0000-0000001103c1' group by 1$$,
  $$select id, -80::numeric from leaf where n = 2$$,
  'percibido: the manual expenses go to their own account, with their center'
);

select * from finish();
rollback;
