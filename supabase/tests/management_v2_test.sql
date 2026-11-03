-- Resultado de gestión v2 (20261103070000): in cash, a collection of an
-- asset sale is "Venta de bienes de uso", a payment of a purchase charged to
-- an employee and an employee advance are "Anticipos al personal" (not
-- operating cost, in either basis), a split installment pays capital and
-- interest apart; the drill-down lists documents that add up to each figure;
-- reading it leaves the fiscal EERR as it was; fiscal_reader reads nothing.
-- Deltas against the current month, so seeds do not matter. One
-- transaction, rolled back.

begin;

select plan(15);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create function pg_temp.pnl(p_basis text, p_bucket text, p_sub text default null)
returns numeric
language sql as $$
  select coalesce(sum(amount_ars), 0)
    from public.get_management_pnl(current_date, current_date, p_basis, false)
   where bucket = p_bucket and (p_sub is null or subbucket = p_sub);
$$;

create temp table before as
select b.basis, k.bucket, pg_temp.pnl(b.basis, k.bucket) as v
  from (values ('accrual'), ('cash')) as b (basis)
  cross join (values ('service_revenue'), ('operating_cost'), ('asset_sale'), ('employee_advances'),
                     ('loan_principal'), ('financing_cost')) as k (bucket);

create function pg_temp.delta(p_basis text, p_bucket text) returns numeric
language sql as $$
  select pg_temp.pnl(p_basis, p_bucket) - (select v from before where basis = p_basis and bucket = p_bucket)
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000016fa', 'contador@gestion-v2.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000016fa', 'fiscal_reader');

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000016c0a1', false, null, 'Cliente Gestión v2', null);
insert into public.suppliers (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000016b0a1', false, null, 'Proveedor Gestión v2', null);
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000016ac01', 'Caja Gestión v2', 'cash', 'ARS');
insert into public.employees (id, legal_name, pay_frequency, base_salary, hire_date) values
  ('00000000-0000-0000-0000-00000016e001', 'Empleado Gestión v2', 'mensual', 1000, '2020-01-01');

-- An internal sale of a truck (asset_sale), collected with a receipt. --------------

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000016e0a1', 'jouve_internal', '00000000-0000-0000-0000-00000016c0a1',
   'factura', null, 9001, 98161, current_date, 2, 99, '0', 1000, 0, 1000, 'emitted', 'gestion-v2-camion');
insert into public.invoice_items
  (invoice_id, description, quantity, unit_price, iva_rate_id, line_neto, line_iva, line_total, revenue_kind)
values
  ('00000000-0000-0000-0000-00000016e0a1', 'Venta camión', 1, 1000, 3, 1000, 0, 1000, 'asset_sale');

create temp table t_receipt as
select public.create_receipt('jouve_internal', 9001, 98161, '00000000-0000-0000-0000-00000016c0a1',
  current_date, 1000, 'ARS', 'cobro camión',
  '[{"account_id":"00000000-0000-0000-0000-00000016ac01","amount":1000}]'::jsonb,
  '[{"invoice_id":"00000000-0000-0000-0000-00000016e0a1","amount_applied":1000}]'::jsonb,
  '[]'::jsonb) as id;

-- An internal purchase charged to the employee, paid with a payment order. ---------

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_total, status, charged_employee_id)
values
  ('00000000-0000-0000-0000-00000016f0a1', 'jouve_internal', '00000000-0000-0000-0000-00000016b0a1',
   'factura', null, 1, 98161, current_date, 400, 400, 'received', '00000000-0000-0000-0000-00000016e001');

create temp table t_op as
select public.create_payment_order(
  'jouve_internal', 9001,
  (select coalesce(max(numero), 0) + 1 from public.payment_orders
    where channel_id = 'jouve_internal' and punto_venta = 9001),
  '00000000-0000-0000-0000-00000016b0a1', current_date, 400, 'ARS', null,
  '[{"account_id":"00000000-0000-0000-0000-00000016ac01","amount":400}]'::jsonb,
  '[{"purchase_invoice_id":"00000000-0000-0000-0000-00000016f0a1","amount_applied":400}]'::jsonb,
  null) as id;

-- An advance to the employee. -------------------------------------------------------

select public.record_employee_account_cash(
  '00000000-0000-0000-0000-00000016e001', 'advance', '00000000-0000-0000-0000-00000016ac01',
  'jouve_internal', current_date, 300, 'Adelanto gestión v2', null, 300);

-- A split installment: 800 capital + 200 interest. -----------------------------------

insert into public.loans (id, channel_id, currency, description, first_due_date, installments_count, kind, principal)
values ('00000000-0000-0000-0000-0000000016b1', 'jouve_internal', 'ARS', 'Préstamo gestión v2', current_date, 1, 'prestamo', 800);
insert into public.loan_installments
  (id, loan_id, number, due_date, amount, capital_amount, interest_amount, iva_amount,
   perception_amount, other_charges_amount)
values ('00000000-0000-0000-0000-0000000016b2', '00000000-0000-0000-0000-0000000016b1', 1, current_date,
        1000, 800, 200, 0, 0, 0);
select public.pay_loan_installment('00000000-0000-0000-0000-0000000016b2', current_date,
  '00000000-0000-0000-0000-00000016ac01', 1000);

set constraints all immediate;

-- Cash ---------------------------------------------------------------------------------

select is(pg_temp.delta('cash', 'asset_sale'), 1000::numeric,
  'cash: collecting the truck sale is a sale of fixed assets');
select is(pg_temp.delta('cash', 'service_revenue'), 0::numeric,
  'cash: and not a service collection');
select is(pg_temp.delta('cash', 'employee_advances'), -700::numeric,
  'cash: the purchase charged to the employee and the advance are advances to staff');
select is(pg_temp.delta('cash', 'loan_principal'), -800::numeric,
  'cash: the split installment pays 800 of capital');
select is(pg_temp.delta('cash', 'financing_cost'), -200::numeric,
  'cash: and 200 of interest, as financing cost');
select is(pg_temp.delta('cash', 'operating_cost'), 0::numeric,
  'cash: nothing of it reaches operating costs');

-- Accrual ----------------------------------------------------------------------------

select is(pg_temp.delta('accrual', 'operating_cost'), 0::numeric,
  'accrual: the purchase charged to the employee is not an operating cost');
select is(pg_temp.delta('accrual', 'asset_sale'), 1000::numeric,
  'accrual: the truck sale is a sale of fixed assets');

-- Drill-down ---------------------------------------------------------------------------

create temp table eerr_before as
select account_id, total_debit, total_credit, balance
  from public.get_account_balances(to_char(current_date, 'YYYY-MM'), null);

select set_eq(
  $$select bucket, sum(amount_ars) from public.get_management_pnl(current_date, current_date, 'cash', false)
     group by bucket$$,
  $$select bucket, sum(amount_ars) from public.get_management_pnl_documents(current_date, current_date, 'cash')
     group by bucket$$,
  'cash: the documents add up to every figure'
);
select set_eq(
  $$select bucket, sum(amount_ars) from public.get_management_pnl(current_date, current_date, 'accrual', false)
     group by bucket$$,
  $$select bucket, sum(amount_ars) from public.get_management_pnl_documents(current_date, current_date, 'accrual')
     group by bucket$$,
  'accrual: the documents add up to every figure'
);
select is(
  (select doc_type || ':' || doc_label
     from public.get_management_pnl_documents(current_date, current_date, 'cash', array['asset_sale'])
    where doc_id = (select id from t_receipt)),
  'receipt:Recibo 9001-00098161',
  'the asset-sale collection names its receipt'
);
select is(
  (select count(*)::int
     from public.get_management_pnl_documents(current_date, current_date, 'cash', array['employee_advances'])
    where doc_type = 'employee' and doc_id = '00000000-0000-0000-0000-00000016e001'),
  1,
  'the advance points to the employee'
);
select set_eq(
  $$select account_id, total_debit, total_credit, balance
      from public.get_account_balances(to_char(current_date, 'YYYY-MM'), null)$$,
  $$select account_id, total_debit, total_credit, balance from eerr_before$$,
  'reading gestión and its drill-down leaves the fiscal EERR exactly as it was'
);

-- Access ---------------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.management_pnl_lines(date, date, text)', 'execute')
  and not has_function_privilege('authenticated',
        'public.get_management_pnl_documents(date, date, text, text[])', 'execute'),
  'the lines and the drill-down are not callable by authenticated'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000016fa","role":"authenticated"}', true);

select throws_ok(
  $$select * from public.get_management_pnl_documents(current_date, current_date, 'accrual')$$,
  '42501',
  null,
  'fiscal_reader cannot call the drill-down'
);

reset role;

select * from finish();
rollback;
