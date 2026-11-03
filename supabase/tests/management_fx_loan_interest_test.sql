-- Resultado de gestión (20261104102000): the exchange differences are a
-- financial result, the interest of an unsplit cuota of a booked loan is not
-- loan principal (accrual and cash), an unbooked loan's cuota still is, and a
-- USD forgiveness with no rate is pending instead of dropped. One
-- transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(8);

select is(
  (select mb.bucket from public.management_buckets mb
     join public.chart_of_accounts coa on coa.id = mb.chart_of_accounts_id
    where coa.system_role = 'diferencia_cambio'
    limit 1),
  'financing_cost',
  'the exchange differences are a financial result, outside the operating margin'
);

-- Loans --------------------------------------------------------------------------------

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000001020a1', 'Banco gestión préstamos', 'bank', 'ARS');

-- Principal 1.050 in 3 unsplit cuotas of 400: the builder pays capital first
-- (1.050 − 800 of the earlier cuotas), so the third carries 250 of capital and
-- 150 of interest. The second loan has no disbursement recorded.
insert into public.loans (id, channel_id, currency, description, first_due_date, installments_count, kind, principal)
values
  ('00000000-0000-0000-0000-0000001020b1', 'jouve_fiscal', 'ARS', 'Préstamo gestión', current_date, 3, 'prestamo', 1050),
  ('00000000-0000-0000-0000-0000001020b2', 'jouve_fiscal', 'ARS', 'Préstamo sin desembolso', current_date, 1, 'prestamo', 500);

insert into public.loan_installments (id, loan_id, number, due_date, amount) values
  ('00000000-0000-0000-0000-0000001020d1', '00000000-0000-0000-0000-0000001020b1', 1, current_date, 400),
  ('00000000-0000-0000-0000-0000001020d2', '00000000-0000-0000-0000-0000001020b1', 2, current_date, 400),
  ('00000000-0000-0000-0000-0000001020d3', '00000000-0000-0000-0000-0000001020b1', 3, current_date, 400),
  ('00000000-0000-0000-0000-0000001020d4', '00000000-0000-0000-0000-0000001020b2', 1, current_date, 500);

create temp table t_disb on commit drop as
  select public.record_loan_disbursement('00000000-0000-0000-0000-0000001020b1',
    '00000000-0000-0000-0000-0000001020a1', current_date, null) as id;

create temp table t_paid on commit drop as
  select i.id as installment_id,
         public.pay_loan_installment(i.id, current_date, '00000000-0000-0000-0000-0000001020a1', i.amount) as tx_id
    from public.loan_installments i
   where i.loan_id in ('00000000-0000-0000-0000-0000001020b1', '00000000-0000-0000-0000-0000001020b2');

set constraints all immediate;
set constraints all deferred;

create temp table t_accrual on commit drop as
  select * from public.management_pnl_lines(current_date, current_date, 'accrual');
create temp table t_cash on commit drop as
  select * from public.management_pnl_lines(current_date, current_date, 'cash');

create function pg_temp.tx(p_installment uuid) returns uuid
language sql as $$ select tx_id from t_paid where installment_id = p_installment $$;

select is(
  (select sum(amount_ars) from t_accrual
    where source_id = pg_temp.tx('00000000-0000-0000-0000-0000001020d3') and bucket = 'loan_principal'),
  -250.00::numeric,
  'accrual: the capital of the last unsplit cuota is loan principal'
);
select is(
  (select sum(amount_ars) from t_accrual
    where source_id = pg_temp.tx('00000000-0000-0000-0000-0000001020d3') and bucket <> 'loan_principal'),
  -150.00::numeric,
  'accrual: its interest is a cost, not principal (as in the EERR)'
);
select is(
  (select sum(amount_ars) from t_accrual
    where source_id = pg_temp.tx('00000000-0000-0000-0000-0000001020d4') and bucket = 'loan_principal'),
  -500.00::numeric,
  'accrual: a cuota of a loan with no booked liability is still principal'
);
select is(
  (select sum(amount_ars) from t_cash
    where source_id = pg_temp.tx('00000000-0000-0000-0000-0000001020d3') and bucket = 'loan_principal'),
  -250.00::numeric,
  'cash: the same cuota pays 250 of principal'
);
select is(
  (select sum(amount_ars) from t_cash
    where source_id = pg_temp.tx('00000000-0000-0000-0000-0000001020d3') and bucket <> 'loan_principal'),
  -150.00::numeric,
  'cash: and 150 of interest'
);

-- USD forgiveness with no rate ---------------------------------------------------------

delete from public.exchange_rates where currency = 'USD' and rate_date <= '1990-01-31';
insert into public.employees (id, legal_name, pay_frequency, base_salary, hire_date) values
  ('00000000-0000-0000-0000-0000001020e1', 'Empleado USD', 'mensual', 1000, '1989-01-01');

insert into public.employee_debt_plans
  (id, employee_id, description, currency, total, installment_amount, start_month)
values
  ('00000000-0000-0000-0000-0000001020c1', '00000000-0000-0000-0000-0000001020e1',
   'Plan USD', 'USD', 100, 100, '1990-01-01');

-- Written as the plan would (the guard only lets the owning trigger write it).
alter table public.employee_account_movements disable trigger employee_account_movements_guard;
insert into public.employee_account_movements
  (id, employee_id, kind, currency, amount, movement_date, description, creditor, plan_id)
values
  ('00000000-0000-0000-0000-0000001020f1', '00000000-0000-0000-0000-0000001020e1',
   'forgiveness', 'USD', 100, '1990-01-15', 'Condonación USD', 'empresa',
   '00000000-0000-0000-0000-0000001020c1');
alter table public.employee_account_movements enable trigger employee_account_movements_guard;

select results_eq(
  $$select bucket, amount_ars, pending_usd
      from public.management_pnl_lines('1990-01-01', '1990-01-31', 'accrual')
     where source_id = '00000000-0000-0000-0000-0000001020f1'$$,
  $$values ('pending_usd'::text, 0::numeric, -100.00::numeric)$$,
  'accrual: a USD forgiveness with no rate is pending, not dropped'
);
select results_eq(
  $$select bucket, amount_ars, pending_usd
      from public.management_pnl_lines('1990-01-01', '1990-01-31', 'cash')
     where source_id = '00000000-0000-0000-0000-0000001020f1'
     order by bucket$$,
  $$values ('employee_advances'::text, 0::numeric, 100.00::numeric),
           ('operating_cost'::text, 0::numeric, -100.00::numeric)$$,
  'cash: both of its sides are pending'
);

select * from finish();
rollback;
