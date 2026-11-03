-- Recategorizar un gasto (20261104000000). recategorize_expense changes the
-- expense account and/or the cost center of a loose expense or a purchase
-- and the entry is re-posted with them; the same values again change
-- nothing; a reconciled expense can still be recategorized (the lock covers
-- money and dates, not these columns); a movement a document owns, an
-- income, a parent account, an inactive center, a closed period, an unknown
-- record and an empty change are refused. Grants. One transaction, rolled
-- back.

begin;

select plan(20);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- The live entry's debit on one account for a document.
create function pg_temp.debit_on(p_source text, p_id uuid, p_account uuid) returns numeric
language sql as $$
  select coalesce(sum(l.debit), 0) from public.journal_entries je
    join public.journal_entry_lines l on l.journal_entry_id = je.id
   where je.source_table = p_source and je.source_id = p_id and not je.is_reversal
     and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = je.id)
     and l.chart_of_accounts_id = p_account;
$$;

create function pg_temp.live_cost_center(p_source text, p_id uuid) returns uuid
language sql as $$
  select je.cost_center_id from public.journal_entries je
   where je.source_table = p_source and je.source_id = p_id and not je.is_reversal
     and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = je.id)
   limit 1;
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000001104e1', 'owner@recategorize.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000001104e1', 'owner');

-- Two postable leaves and one parent expense account of the seeded chart.
create temporary table t_leaf as
  select e.id, row_number() over (order by e.code) as n
    from public.expense_leaf_accounts e
   order by e.code
   limit 2;
create temporary table t_parent as
  select c.id
    from public.chart_of_accounts c
   where c.account_type = 'resultado_negativo' and c.is_active
     and exists (select 1 from public.chart_of_accounts ch where ch.parent_id = c.id and ch.is_active)
   limit 1;

insert into public.cost_centers (id, code, name, is_active) values
  ('00000000-0000-0000-0000-0000001104c1', 'RECAT_FLOTA', 'Flota recategorizar', true),
  ('00000000-0000-0000-0000-0000001104c2', 'RECAT_VIEJO', 'Centro inactivo', false);
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000001104a1', 'Banco Recategorizar', 'bank', 'ARS');
insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000001104b1', '30777777771', 'Proveedor Recategorizar', 'responsable_inscripto');

insert into public.transactions
  (id, account_id, channel_id, kind, amount, currency, transaction_date, accrual_month,
   description, is_payroll)
values
  -- A loose expense, reconciled below.
  ('00000000-0000-0000-0000-0000001104d1', '00000000-0000-0000-0000-0000001104a1', 'jouve_fiscal',
   'expense', 100, 'ARS', '1993-05-10', '1993-05-01', 'Gasoil', false),
  -- A payroll payment: a document owns it.
  ('00000000-0000-0000-0000-0000001104d2', '00000000-0000-0000-0000-0000001104a1', 'jouve_fiscal',
   'expense', 200, 'ARS', '1993-05-11', '1993-05-01', 'Sueldo', true),
  -- An income.
  ('00000000-0000-0000-0000-0000001104d3', '00000000-0000-0000-0000-0000001104a1', 'jouve_fiscal',
   'income', 300, 'ARS', '1993-05-12', '1993-05-01', 'Ingreso', false),
  -- A loose expense whose period gets closed.
  ('00000000-0000-0000-0000-0000001104d4', '00000000-0000-0000-0000-0000001104a1', 'jouve_fiscal',
   'expense', 400, 'ARS', '1993-07-10', '1993-07-01', 'Peaje', false);

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, status, account_id)
values
  ('00000000-0000-0000-0000-0000001104f1', 'jouve_fiscal', '00000000-0000-0000-0000-0000001104b1',
   'factura', 'A', 11, 1104, '1993-05-15', 1000, 210, 1210, 'received',
   (select id from t_leaf where n = 1));
set constraints all immediate;

-- The statement: one debit, reconciled with the loose expense.
create temporary table t_stmt as
  select public.commit_import_run(
    'bank_statement', 'extracto-recategorizar.csv', repeat('8', 64), '{}'::jsonb, 1, 0, 0,
    jsonb_build_array(
      jsonb_build_object('account_id', '00000000-0000-0000-0000-0000001104a1', 'line_date', '1993-05-10',
        'description', 'Débito gasoil', 'amount', -100, 'balance', null, 'reference', null,
        'source_hash', repeat('f', 64), 'line_no', 2)
    ),
    '00000000-0000-0000-0000-0000001104e1') as id;
select public.match_bank_statement_line(
  (select id from public.bank_statement_lines where import_run_id = (select id from t_stmt)),
  array['00000000-0000-0000-0000-0000001104d1']::uuid[],
  '00000000-0000-0000-0000-0000001104e1');

-- 1. Grants -----------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated',
        'public.recategorize_expense(text, uuid, boolean, boolean, uuid, uuid)', 'execute')
  and not has_function_privilege('anon',
        'public.recategorize_expense(text, uuid, boolean, boolean, uuid, uuid)', 'execute')
  and has_function_privilege('service_role',
        'public.recategorize_expense(text, uuid, boolean, boolean, uuid, uuid)', 'execute'),
  'only the service role recategorizes'
);

-- 2. A reconciled loose expense ---------------------------------------------------

select is(
  (public.recategorize_expense('transactions', '00000000-0000-0000-0000-0000001104d1', true, true,
     (select id from t_leaf where n = 1), '00000000-0000-0000-0000-0000001104c1') ->> 'changed')::boolean,
  true,
  'a reconciled expense takes a new account and cost center'
);
set constraints all immediate;

select results_eq(
  $$select expense_account_id, cost_center_id, amount, transaction_date from public.transactions
     where id = '00000000-0000-0000-0000-0000001104d1'$$,
  $$select (select id from t_leaf where n = 1), '00000000-0000-0000-0000-0000001104c1'::uuid,
           100::numeric(18,2), '1993-05-10'::date$$,
  'the movement keeps its money fields'
);
select is(
  pg_temp.debit_on('transactions', '00000000-0000-0000-0000-0000001104d1', (select id from t_leaf where n = 1)),
  100::numeric, 'the entry now debits the new account');
select is(
  pg_temp.live_cost_center('transactions', '00000000-0000-0000-0000-0000001104d1'),
  '00000000-0000-0000-0000-0000001104c1'::uuid, 'and carries the new cost center');
select is(
  (select count(*)::int from public.bank_statement_matches
    where transaction_id = '00000000-0000-0000-0000-0000001104d1'),
  1, 'the movement stays reconciled');

select is(
  (public.recategorize_expense('transactions', '00000000-0000-0000-0000-0000001104d1', true, false,
     (select id from t_leaf where n = 1)) ->> 'changed')::boolean,
  false,
  'the same account again changes nothing'
);

select is(
  public.recategorize_expense('transactions', '00000000-0000-0000-0000-0000001104d1', false, true)
    ->> 'cost_center_id_before',
  '00000000-0000-0000-0000-0000001104c1',
  'clearing the cost center returns the one it had'
);
set constraints all immediate;
select is(
  (select cost_center_id from public.transactions where id = '00000000-0000-0000-0000-0000001104d1'),
  null::uuid, 'and the movement has none');
select is(
  (select expense_account_id from public.transactions where id = '00000000-0000-0000-0000-0000001104d1'),
  (select id from t_leaf where n = 1), 'while the account it kept stays');

-- 3. A purchase -------------------------------------------------------------------

select lives_ok(
  format($$select public.recategorize_expense('purchase_invoices',
      '00000000-0000-0000-0000-0000001104f1', true, false, %L)$$, (select id from t_leaf where n = 2)),
  'a received purchase takes another account');
set constraints all immediate;
select is(
  pg_temp.debit_on('purchase_invoices', '00000000-0000-0000-0000-0000001104f1', (select id from t_leaf where n = 2)),
  1000::numeric, 'its neto now posts to the new account');

-- 4. Refusals (as the owner of the test transaction) ------------------------------

select throws_ok(
  $$select public.recategorize_expense('transactions', '00000000-0000-0000-0000-0000001104d2', false, true,
      null, '00000000-0000-0000-0000-0000001104c1')$$,
  '55006', null, 'a movement a document owns is refused');
select throws_ok(
  $$select public.recategorize_expense('transactions', '00000000-0000-0000-0000-0000001104d3', false, true,
      null, '00000000-0000-0000-0000-0000001104c1')$$,
  '23514', 'Solo se recategoriza un egreso', 'an income is refused');
select throws_ok(
  format($$select public.recategorize_expense('transactions', '00000000-0000-0000-0000-0000001104d1',
      true, false, %L)$$, (select id from t_parent)),
  '23514', null, 'a parent account is refused');
select throws_ok(
  $$select public.recategorize_expense('transactions', '00000000-0000-0000-0000-0000001104d1', false, true,
      null, '00000000-0000-0000-0000-0000001104c2')$$,
  '23514', 'El centro de costo no existe o está inactivo', 'an inactive cost center is refused');

insert into public.accounting_closed_periods (period) values ('1993-07');
select throws_ok(
  $$select public.recategorize_expense('transactions', '00000000-0000-0000-0000-0000001104d4', false, true,
      null, '00000000-0000-0000-0000-0000001104c1')$$,
  '55006', null, 'an expense in a closed period is refused');

select throws_ok(
  $$select public.recategorize_expense('purchase_invoices', '00000000-0000-0000-0000-0000001104ff', false, true,
      null, '00000000-0000-0000-0000-0000001104c1')$$,
  'P0002', 'No se encontró la compra', 'an unknown purchase is refused');
select throws_ok(
  $$select public.recategorize_expense('transactions', '00000000-0000-0000-0000-0000001104d1', false, false)$$,
  '22023', 'Indicá la cuenta de gasto o el centro de costo', 'an empty change is refused');
select throws_ok(
  $$select public.recategorize_expense('invoices', '00000000-0000-0000-0000-0000001104d1', false, true)$$,
  '22023', null, 'an unknown source is refused');

select * from finish();

rollback;
