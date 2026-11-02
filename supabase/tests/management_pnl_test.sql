-- Roadmap 1.0 (20261102260000): the Resultado de gestión adds the fiscal
-- journal and the internal documents without touching the fiscal books.
-- Payroll counts once per side by liquidation month, a billed remito counts
-- once, a truck sale and a loan installment stay out of the operating margin,
-- own transfers are zero, coefficient 1 changes nothing, and fiscal_reader
-- reads nothing. Deltas against the current month, so seeds do not matter.
-- One transaction, rolled back.

begin;

select plan(15);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create function pg_temp.pnl(p_from date, p_to date, p_basis text, p_bucket text, p_sub text default null)
returns numeric
language sql as $$
  select coalesce(sum(amount_ars), 0)
    from public.get_management_pnl(p_from, p_to, p_basis, false)
   where bucket = p_bucket and (p_sub is null or subbucket = p_sub);
$$;

create temp table before as
select 'service_revenue'::text as k, pg_temp.pnl(current_date, current_date, 'accrual', 'service_revenue') as v
union all select 'asset_sale', pg_temp.pnl(current_date, current_date, 'accrual', 'asset_sale')
union all select 'operating_cost', pg_temp.pnl(current_date, current_date, 'accrual', 'operating_cost')
union all select 'loan_principal', pg_temp.pnl(current_date, current_date, 'accrual', 'loan_principal')
union all select 'cash_total', (select coalesce(sum(amount_ars), 0)
                                  from public.get_management_pnl(current_date, current_date, 'cash', false));

create function pg_temp.delta(p_key text, p_now numeric) returns numeric
language sql as $$ select p_now - (select v from before where k = p_key) $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000015fa', 'contador@gestion.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000015fa', 'fiscal_reader');

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000015c0f1', true, '20999999915', 'Cliente Gestión', 'responsable_inscripto'),
  ('00000000-0000-0000-0000-00000015c0a1', false, null, 'Cliente Gestión Interno', null);
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000015ac01', 'Banco Gestión', 'bank', 'ARS'),
  ('00000000-0000-0000-0000-00000015ac02', 'Caja Gestión', 'cash', 'ARS');

-- Payroll: 100 fiscal + 50 internal liquidated in 1992-03; the internal one
-- paid in April. -------------------------------------------------------------------

insert into public.transactions
  (account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description, is_payroll)
values
  ('00000000-0000-0000-0000-00000015ac01', 'jouve_fiscal', 'expense', 100, 'ARS',
   '1992-03-28', '1992-03-01', 'Sueldo fiscal', true),
  ('00000000-0000-0000-0000-00000015ac02', 'jouve_internal', 'expense', 50, 'ARS',
   '1992-04-05', '1992-03-01', 'Sueldo extra', true);

set constraints all immediate;

select is(
  pg_temp.pnl('1992-03-01', '1992-03-31', 'accrual', 'operating_cost', 'sueldos'),
  -100::numeric,
  'Sueldos (fiscal) counts the fiscal payment once, from its entry'
);
select is(
  pg_temp.pnl('1992-03-01', '1992-03-31', 'accrual', 'operating_cost', 'sueldos_internos'),
  -50::numeric,
  'Sueldos internos (extras) counts the internal one'
);
select is(
  pg_temp.pnl('1992-03-01', '1992-03-31', 'accrual', 'operating_cost'),
  -150::numeric,
  'personal in gestión is 150, by liquidation month even if paid later'
);
select is(
  (select sum(b.balance) from public.get_account_balances('1992-03', '1992-03') b
     join public.chart_of_accounts c on c.id = b.account_id
    where c.system_role = 'sueldos'),
  100::numeric,
  'the fiscal EERR still shows 100'
);

-- Inflation: coefficient 1 is the same result. ------------------------------------

insert into public.inflation_adjustments (period, coefficient) values ('1992-03', 1);
select results_eq(
  $$select month, bucket, subbucket, channel_side, chart_account_id, amount_ars
      from public.get_management_pnl('1992-03-01', '1992-03-31', 'accrual', true) order by 1, 2, 3, 4, 5$$,
  $$select month, bucket, subbucket, channel_side, chart_account_id, amount_ars
      from public.get_management_pnl('1992-03-01', '1992-03-31', 'accrual', false) order by 1, 2, 3, 4, 5$$,
  'with coefficient 1 the adjusted result is the same'
);

-- A remito billed on a fiscal factura counts once. ------------------------------------

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000015e0a1', 'jouve_internal', '00000000-0000-0000-0000-00000015c0a1',
   'factura', null, 9001, 98151, current_date, 2, 99, '0', 1000, 0, 1000, 'emitted', 'gestion-remito');
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key, source_remito_id)
values
  ('00000000-0000-0000-0000-00000015e0f1', 'jouve_fiscal', '00000000-0000-0000-0000-00000015c0f1',
   'factura', 'A', 3, null, current_date, 2, 80, '20999999915', 1000, 210, 1210, 1, 1,
   'draft', 'gestion-factura', '00000000-0000-0000-0000-00000015e0a1');
update public.invoices set status = 'emitted', numero = 98151
 where id = '00000000-0000-0000-0000-00000015e0f1';
create temp table t_nc as
select public.settle_billed_remito('00000000-0000-0000-0000-00000015e0f1') as nc;
update public.invoices set status = 'emitted', numero = 98152
 where id = (select nc from t_nc);

-- A truck sold at 10.5 %, marked as an asset sale. ------------------------------------

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000015e0f2', 'jouve_fiscal', '00000000-0000-0000-0000-00000015c0f1',
   'factura', 'A', 3, 98153, current_date, 2, 80, '20999999915', 5000, 525, 5525, 1, 1,
   'emitted', 'gestion-camion');
insert into public.invoice_items
  (invoice_id, description, quantity, unit_price, iva_rate_id, line_neto, line_iva, line_total, revenue_kind)
values
  ('00000000-0000-0000-0000-00000015e0f2', 'Venta camión dominio AA000AA', 1, 5000, 4, 5000, 525, 5525, 'asset_sale');

-- A loan installment paid this month. ----------------------------------------------

insert into public.loans (id, channel_id, currency, description, first_due_date, installments_count, kind, principal)
values ('00000000-0000-0000-0000-0000000015b1', 'jouve_fiscal', 'ARS', 'Préstamo gestión', current_date, 1, 'prestamo', 700);
insert into public.loan_installments (id, loan_id, number, due_date, amount)
values ('00000000-0000-0000-0000-0000000015b2', '00000000-0000-0000-0000-0000000015b1', 1, current_date, 700);
select public.pay_loan_installment('00000000-0000-0000-0000-0000000015b2', current_date,
  '00000000-0000-0000-0000-00000015ac01', 700);

-- An own transfer. -----------------------------------------------------------------
-- The pair FK is deferred (20260516216000): the earlier `set constraints all
-- immediate` must be undone before the two legs are inserted.
set constraints all deferred;

select public.create_transfer('00000000-0000-0000-0000-00000015ac01', '00000000-0000-0000-0000-00000015ac02',
  'jouve_internal', 300, 'ARS', current_date, date_trunc('month', current_date)::date, 'Entre cuentas');

set constraints all immediate;

select is(
  pg_temp.delta('service_revenue', pg_temp.pnl(current_date, current_date, 'accrual', 'service_revenue')),
  1000::numeric,
  'remito + its settlement NC + the fiscal factura: the sale counts once'
);
select is(
  pg_temp.delta('asset_sale', pg_temp.pnl(current_date, current_date, 'accrual', 'asset_sale')),
  5000::numeric,
  'the truck sale is a sale of fixed assets'
);
select is(
  pg_temp.delta('loan_principal', pg_temp.pnl(current_date, current_date, 'accrual', 'loan_principal')),
  -700::numeric,
  'the loan installment is principal'
);
select is(
  pg_temp.delta('operating_cost', pg_temp.pnl(current_date, current_date, 'accrual', 'operating_cost')),
  0::numeric,
  'neither the installment nor the transfer reaches operating costs'
);
select is(
  pg_temp.delta('cash_total', (select coalesce(sum(amount_ars), 0)
                                 from public.get_management_pnl(current_date, current_date, 'cash', false))),
  -700::numeric,
  'in cash, only the installment moves: the own transfer is zero'
);

create temp table eerr_mid as
select account_id, total_debit, total_credit, balance
  from public.get_account_balances(to_char(current_date, 'YYYY-MM'), null);
update public.invoice_items set revenue_kind = 'service'
 where invoice_id = '00000000-0000-0000-0000-00000015e0f2';
create temp table t_read as
select * from public.get_management_pnl(current_date, current_date, 'accrual', true);
select set_eq(
  $$select account_id, total_debit, total_credit, balance
      from public.get_account_balances(to_char(current_date, 'YYYY-MM'), null)$$,
  $$select account_id, total_debit, total_credit, balance from eerr_mid$$,
  'reading gestión or re-marking an item leaves the fiscal EERR exactly as it was'
);

select throws_ok(
  $$select * from public.get_management_pnl(current_date, current_date, 'otra', false)$$,
  '22023',
  null,
  'an unknown basis is refused'
);

-- fiscal_reader reads nothing. --------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000015fa","role":"authenticated"}', true);

select throws_ok(
  $$select * from public.get_management_pnl(current_date, current_date, 'accrual', false)$$,
  '42501',
  null,
  'fiscal_reader cannot call the management P&L'
);
select throws_ok(
  $$select * from public.get_management_payroll_control(current_date, current_date)$$,
  '42501',
  null,
  'nor the payroll control'
);
select is(
  (select count(*)::int from public.management_buckets),
  0,
  'and RLS hides the bucket catalog'
);

reset role;

select * from finish();
rollback;
