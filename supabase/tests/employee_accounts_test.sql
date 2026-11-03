-- Cuenta corriente del empleado (D1, roadmap 3.3–3.4) and aumentos en %
-- (3.6): an advance from a cash account opens a plan and posts to anticipos
-- al personal, the plan's installment is the draft planilla's Deudas (a hand
-- edit overrides it), closing writes the discount and reopening takes it
-- back, the owned movements are guarded (asserted as the table owner: as
-- `authenticated`, RLS would silently filter the UPDATE/DELETE), forgiving a
-- plan, a purchase charged to an employee, a raise from a month, and the
-- grants. One transaction, rolled back.

begin;

select plan(33);

create function pg_temp.balance(p_employee uuid) returns numeric
language sql as $$
  select coalesce(sum(balance), 0) from public.v_employee_account_balances
   where employee_id = p_employee and currency = 'ARS';
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000ea1', 'finance@employee-accounts.test'),
  ('00000000-0000-0000-0000-000000000ea2', 'ops@employee-accounts.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-000000000ea1', 'finance'),
  ('00000000-0000-0000-0000-000000000ea2', 'operations');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000ea1","role":"authenticated"}', true);

insert into public.employees (id, legal_name, pay_frequency, base_salary, hire_date) values
  ('00000000-0000-0000-0000-000000000eb1', 'Cuenta Corriente Uno', 'mensual', 1000, '2090-01-01');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-000000000ec1', 'Caja anticipos', 'cash', 'ARS');
insert into public.payroll_periods (id, year, month) values
  ('00000000-0000-0000-0000-000000000ed1', 2099, 3);
insert into public.payroll_entries (id, period_id, employee_id, sueldo_neto) values
  ('00000000-0000-0000-0000-000000000ee1', '00000000-0000-0000-0000-000000000ed1',
   '00000000-0000-0000-0000-000000000eb1', 1000);

-- 1. COA ---------------------------------------------------------------------------

select isnt(
  public.find_account_by_role('anticipos_personal'), null,
  'an active account holds the anticipos_personal role'
);

-- 2. An advance from the cash account ------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000ea2","role":"authenticated"}', true);
select throws_ok(
  $$select public.record_employee_account_cash(
      '00000000-0000-0000-0000-000000000eb1', 'advance', '00000000-0000-0000-0000-000000000ec1',
      'jouve_fiscal', '2099-03-05', 3000)$$,
  '42501', null,
  'a role without hr:write cannot record an advance'
);
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000ea1","role":"authenticated"}', true);

select throws_ok(
  $$select public.record_employee_account_cash(
      '00000000-0000-0000-0000-000000000eb1', 'advance', '00000000-0000-0000-0000-000000000ec1',
      'jouve_fiscal', '2099-03-05', 3000, null, gen_random_uuid())$$,
  '23514', null,
  'an advance does not go against an existing plan'
);

create temp table adv as
select public.record_employee_account_cash(
  '00000000-0000-0000-0000-000000000eb1', 'advance', '00000000-0000-0000-0000-000000000ec1',
  'jouve_fiscal', '2099-03-05', 3000, 'Adelanto de prueba', null, 1000) as movement_id;

set constraints all immediate;

select is(pg_temp.balance('00000000-0000-0000-0000-000000000eb1'), 3000.00::numeric,
  'the advance is owed by the employee');

select results_eq(
  $$select total, installment_amount, start_month, status, remaining
      from public.v_employee_debt_plans
     where employee_id = '00000000-0000-0000-0000-000000000eb1'$$,
  $$values (3000.00::numeric, 1000.00::numeric, '2099-03-01'::date, 'activo'::text, 3000.00::numeric)$$,
  'it opens a plan in installments from its month'
);

select is(
  (select t.source_document from public.v_transactions_tagged t
     join public.employee_account_movements m on m.transaction_id = t.id
     join adv on adv.movement_id = m.id),
  'employee_account',
  'its treasury movement is tagged as owned by the employee account'
);

select ok(
  exists (
    select 1
      from public.employee_account_movements m
      join adv on adv.movement_id = m.id
      join public.journal_entries je
        on je.source_table = 'transactions' and je.source_id = m.transaction_id and not je.is_reversal
      join public.journal_entry_lines l on l.journal_entry_id = je.id
     where l.chart_of_accounts_id = public.find_account_by_role('anticipos_personal')
       and l.debit = 3000),
  'the advance debits anticipos al personal, not an expense'
);

-- 3. Planilla -------------------------------------------------------------------------

select is(
  (select deudas from public.payroll_entries where id = '00000000-0000-0000-0000-000000000ee1'),
  1000.00::numeric,
  'the draft entry discounts the plan installment'
);

update public.payroll_entries set deudas = 400 where id = '00000000-0000-0000-0000-000000000ee1';
select is(
  (select deudas_override from public.payroll_entries where id = '00000000-0000-0000-0000-000000000ee1'),
  true,
  'a hand edit of Deudas marks the override'
);

update public.employee_debt_plans set installment_amount = 1500
 where employee_id = '00000000-0000-0000-0000-000000000eb1';
select is(
  (select deudas from public.payroll_entries where id = '00000000-0000-0000-0000-000000000ee1'),
  400.00::numeric,
  'an overridden Deudas survives a plan change'
);

update public.payroll_entries set deudas_override = false where id = '00000000-0000-0000-0000-000000000ee1';
select is(
  (select deudas from public.payroll_entries where id = '00000000-0000-0000-0000-000000000ee1'),
  1500.00::numeric,
  'dropping the override goes back to the installment'
);

update public.payroll_periods set status = 'closed' where id = '00000000-0000-0000-0000-000000000ed1';
select results_eq(
  $$select kind, amount, plan_id is not null
      from public.employee_account_movements
     where payroll_entry_id = '00000000-0000-0000-0000-000000000ee1'$$,
  $$values ('payroll_discount'::text, 1500.00::numeric, true)$$,
  'closing the period writes the discount to the plan'
);
select is(pg_temp.balance('00000000-0000-0000-0000-000000000eb1'), 1500.00::numeric,
  'and lowers what the employee owes');

-- 4. Owned movements, as the owner -----------------------------------------------------

select throws_ok(
  $$delete from public.employee_account_movements
     where payroll_entry_id = '00000000-0000-0000-0000-000000000ee1'$$,
  '55006', null,
  'the planilla discount is deleted by reopening the period, not by hand'
);
select throws_ok(
  $$update public.employee_account_movements m set amount = 1
      from adv where m.id = adv.movement_id$$,
  '55006', null,
  'an advance amount is not edited by hand'
);
select lives_ok(
  $$update public.employee_account_movements m set description = 'Adelanto corregido'
      from adv where m.id = adv.movement_id$$,
  'its description is'
);
select throws_ok(
  $$delete from public.transactions t
     using public.employee_account_movements m, adv
     where m.id = adv.movement_id and t.id = m.transaction_id$$,
  '55006', null,
  'the treasury movement of an advance cannot be deleted on its own'
);
select throws_ok(
  $$select public.delete_employee_account_movement((select movement_id from adv))$$,
  '55006', null,
  'an advance whose plan was already discounted cannot be deleted'
);

update public.payroll_periods set status = 'draft' where id = '00000000-0000-0000-0000-000000000ed1';
select is(
  (select count(*)::int from public.employee_account_movements
    where payroll_entry_id = '00000000-0000-0000-0000-000000000ee1'),
  0,
  'reopening the period takes the discount back'
);

select lives_ok(
  $$select public.delete_employee_account_movement((select movement_id from adv))$$,
  'then the advance can be deleted'
);
select is(
  (select count(*)::int from public.employee_debt_plans
    where employee_id = '00000000-0000-0000-0000-000000000eb1'),
  0,
  'with the plan it opened'
);
select is(
  (select deudas from public.payroll_entries where id = '00000000-0000-0000-0000-000000000ee1'),
  0.00::numeric,
  'and the draft entry no longer discounts it'
);

-- 5. A plan forgiven ----------------------------------------------------------------

insert into public.employee_debt_plans
  (id, employee_id, description, currency, total, installment_amount, start_month, creditor)
values
  ('00000000-0000-0000-0000-000000000ef1', '00000000-0000-0000-0000-000000000eb1',
   'Deuda con socio', 'ARS', 500, 100, '2099-01-01', 'socio');
insert into public.employee_account_movements
  (employee_id, kind, currency, amount, movement_date, description, creditor, plan_id)
values
  ('00000000-0000-0000-0000-000000000eb1', 'charge', 'ARS', 500, '2099-01-01',
   'Préstamo del socio', 'socio', '00000000-0000-0000-0000-000000000ef1');

update public.employee_debt_plans set status = 'condonado'
 where id = '00000000-0000-0000-0000-000000000ef1';
select results_eq(
  $$select kind, amount, creditor from public.employee_account_movements
     where plan_id = '00000000-0000-0000-0000-000000000ef1' and kind = 'forgiveness'$$,
  $$values ('forgiveness'::text, 500.00::numeric, 'socio'::text)$$,
  'forgiving a plan writes off what remains, with its creditor'
);
select is(pg_temp.balance('00000000-0000-0000-0000-000000000eb1'), 0.00::numeric,
  'and the account is settled');
select throws_ok(
  $$update public.employee_debt_plans set status = 'activo'
     where id = '00000000-0000-0000-0000-000000000ef1'$$,
  '55006', null,
  'a forgiven plan does not change status again'
);
select throws_ok(
  $$update public.employee_debt_plans set total = 400
     where id = '00000000-0000-0000-0000-000000000ef1'$$,
  '23514', null,
  'a plan total cannot drop below what was paid'
);

-- 6. A purchase charged to the employee -------------------------------------------------

insert into public.suppliers (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-000000000e51', true, '30999999994', 'Proveedor a cargo', 'responsable_inscripto');
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, status, charged_employee_id)
values
  ('00000000-0000-0000-0000-000000000e52', 'jouve_fiscal', '00000000-0000-0000-0000-000000000e51',
   'factura', 'A', 9, 77, '2099-02-10', 1000, 210, 1210, 'received',
   '00000000-0000-0000-0000-000000000eb1');
set constraints all immediate;

select results_eq(
  $$select kind, amount, currency from public.employee_account_movements
     where purchase_invoice_id = '00000000-0000-0000-0000-000000000e52'$$,
  $$values ('charge'::text, 1210.00::numeric, 'ARS'::text)$$,
  'its total is a charge in the employee account'
);
select ok(
  exists (
    select 1
      from public.journal_entries je
      join public.journal_entry_lines l on l.journal_entry_id = je.id
     where je.source_table = 'purchase_invoices'
       and je.source_id = '00000000-0000-0000-0000-000000000e52'
       and not je.is_reversal
       and l.chart_of_accounts_id = public.find_account_by_role('anticipos_personal')
       and l.debit = 1000),
  'its neto posts to anticipos al personal'
);

update public.purchase_invoices set status = 'cancelled', cancelled_at = now()
 where id = '00000000-0000-0000-0000-000000000e52';
select is(
  (select count(*)::int from public.employee_account_movements
    where purchase_invoice_id = '00000000-0000-0000-0000-000000000e52'),
  0,
  'cancelling the purchase takes the charge back'
);

-- 7. Raise from a month ----------------------------------------------------------------

insert into public.payroll_periods (id, year, month) values
  ('00000000-0000-0000-0000-000000000ed2', 2099, 4);
insert into public.payroll_entries (id, period_id, employee_id, sueldo_neto) values
  ('00000000-0000-0000-0000-000000000ee2', '00000000-0000-0000-0000-000000000ed2',
   '00000000-0000-0000-0000-000000000eb1', 1000);

select is(
  public.apply_salary_raise(array['00000000-0000-0000-0000-000000000eb1'::uuid], 10, '2099-04-01', 'Paritaria'),
  1,
  'the raise reaches the employee'
);
select results_eq(
  $$select (select base_salary from public.employees where id = '00000000-0000-0000-0000-000000000eb1'),
           public.employee_salary_for_month('00000000-0000-0000-0000-000000000eb1', '2099-03-01'),
           public.employee_salary_for_month('00000000-0000-0000-0000-000000000eb1', '2099-04-01')$$,
  $$values (1100.00::numeric, 1000.00::numeric, 1100.00::numeric)$$,
  'the salary history answers the salary of each month'
);
select results_eq(
  $$select (select sueldo_neto from public.payroll_entries where id = '00000000-0000-0000-0000-000000000ee1'),
           (select sueldo_neto from public.payroll_entries where id = '00000000-0000-0000-0000-000000000ee2')$$,
  $$values (1000.00::numeric, 1100.00::numeric)$$,
  'only the draft planillas from its month on take it'
);

-- 8. Grants --------------------------------------------------------------------------

select ok(
  not has_table_privilege('anon', 'public.employee_account_movements', 'select')
  and not has_table_privilege('authenticated', 'public.employee_salary_changes', 'insert')
  and not has_function_privilege('anon', 'public.record_employee_account_cash(uuid, text, uuid, text, date, numeric, text, uuid, numeric)', 'execute')
  and not has_function_privilege('authenticated', 'public.employee_plans_refresh_entries(uuid)', 'execute'),
  'anon reads nothing, the salary history is written by its trigger alone'
);

select * from finish();

rollback;
