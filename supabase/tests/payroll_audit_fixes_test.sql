-- Payroll and employee-account fixes (20261104095000–20261104095200):
-- the final settlement's SAC extra is not SAC remuneration, a hand-typed
-- embargo survives garnishment writes, and a purchase charged to an employee
-- charges what the company does not recover. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(9);

-- 1. SAC of the final settlement ----------------------------------------------------

insert into public.employees (id, legal_name, pay_frequency, base_salary, hire_date, termination_date, is_active) values
  ('00000000-0000-0000-0000-00000095a001', 'Baja Liquidada', 'mensual', 1000, '2080-01-01', '2087-11-30', false);
insert into public.payroll_periods (id, year, month) values
  ('00000000-0000-0000-0000-00000095b001', 2087, 11);
insert into public.payroll_entries (id, period_id, employee_id, sueldo_neto) values
  ('00000000-0000-0000-0000-00000095c001', '00000000-0000-0000-0000-00000095b001',
   '00000000-0000-0000-0000-00000095a001', 1000);

-- Jul 1 – Nov 30: 153 of the 184 days of the second half.
select is(
  public.payroll_sac_suggestion('00000000-0000-0000-0000-00000095a001', 2087, 2),
  415.76::numeric,
  'the proportional SAC is half the best month, prorated by days'
);

-- applyFinalSettlementAction writes it as an extra of the leaving month.
insert into public.payroll_entry_extras (entry_id, amount, description, sort_order) values
  ('00000000-0000-0000-0000-00000095c001', 415.76,
   'Liquidación final: SAC proporcional (SAC 2.º semestre 2087)', 900);

select is(
  public.payroll_sac_suggestion('00000000-0000-0000-0000-00000095a001', 2087, 2),
  415.76::numeric,
  're-reading after the SAC extra is written gives the same SAC (no compounding)'
);

insert into public.payroll_entry_extras (entry_id, amount, description) values
  ('00000000-0000-0000-0000-00000095c001', 200, 'Horas extra');

select is(
  public.payroll_sac_suggestion('00000000-0000-0000-0000-00000095a001', 2087, 2),
  498.91::numeric,
  'other extras still count as remuneration'
);

-- 2. Hand-typed embargo --------------------------------------------------------------

insert into public.employees (id, legal_name, pay_frequency, base_salary, hire_date) values
  ('00000000-0000-0000-0000-00000095a002', 'Embargo A Mano', 'mensual', 1000, '2080-01-01');
insert into public.payroll_periods (id, year, month) values
  ('00000000-0000-0000-0000-00000095b002', 2087, 12);
insert into public.payroll_entries (id, period_id, employee_id, sueldo_neto) values
  ('00000000-0000-0000-0000-00000095c002', '00000000-0000-0000-0000-00000095b001',
   '00000000-0000-0000-0000-00000095a002', 1000),
  ('00000000-0000-0000-0000-00000095c003', '00000000-0000-0000-0000-00000095b002',
   '00000000-0000-0000-0000-00000095a002', 1000);

update public.payroll_entries set embargo = 70
 where id = '00000000-0000-0000-0000-00000095c002';

select is(
  (select embargo_override from public.payroll_entries where id = '00000000-0000-0000-0000-00000095c002'),
  true,
  'typing the embargo by hand marks it as an override'
);

-- A garnishment active only from December.
insert into public.employee_garnishments (employee_id, mode, percentage, active_from, beneficiary) values
  ('00000000-0000-0000-0000-00000095a002', 'percentage', 10, '2087-12-01', 'Cuota alimentaria');

select results_eq(
  $$select embargo from public.payroll_entries
     where id in ('00000000-0000-0000-0000-00000095c002', '00000000-0000-0000-0000-00000095c003')
     order by id$$,
  $$values (70.00::numeric), (100.00::numeric)$$,
  'a garnishment write keeps the hand-typed November embargo and sets December'
);

update public.payroll_entries set sueldo_neto = 2000
 where id = '00000000-0000-0000-0000-00000095c002';

select is(
  (select embargo from public.payroll_entries where id = '00000000-0000-0000-0000-00000095c002'),
  70.00::numeric,
  'a salary change keeps the hand-typed embargo'
);

update public.payroll_entries set embargo_override = false
 where id = '00000000-0000-0000-0000-00000095c002';

select is(
  (select embargo from public.payroll_entries where id = '00000000-0000-0000-0000-00000095c002'),
  0.00::numeric,
  'clearing the override recomputes it (no garnishment in November)'
);

-- 3. Purchase charged to an employee ---------------------------------------------------

insert into public.suppliers (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000095d001', true, '30999999994', 'Proveedor Cargo Fiscal', 'responsable_inscripto'),
  ('00000000-0000-0000-0000-00000095d002', false, null, 'Proveedor Cargo Interno', null);
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_trib, imp_total, status, charged_employee_id)
values
  ('00000000-0000-0000-0000-00000095e001', 'jouve_fiscal', '00000000-0000-0000-0000-00000095d001',
   'factura', 'A', 9, 9501, '2087-11-10', 1000, 210, 30, 1240, 'received',
   '00000000-0000-0000-0000-00000095a002'),
  ('00000000-0000-0000-0000-00000095e002', 'jouve_internal', '00000000-0000-0000-0000-00000095d002',
   'factura', null, 1, 9502, '2087-11-10', 500, 0, 0, 500, 'received',
   '00000000-0000-0000-0000-00000095a002');
set constraints all immediate;

select results_eq(
  $$select purchase_invoice_id::text, amount from public.employee_account_movements
     where purchase_invoice_id in ('00000000-0000-0000-0000-00000095e001',
                                   '00000000-0000-0000-0000-00000095e002')
     order by purchase_invoice_id$$,
  $$values ('00000000-0000-0000-0000-00000095e001'::text, 1000.00::numeric),
           ('00000000-0000-0000-0000-00000095e002'::text, 500.00::numeric)$$,
  'a fiscal purchase charges the neto (IVA and percepciones are the company''s credit); an internal one the total'
);

select is(
  (select l.debit
     from public.journal_entries je
     join public.journal_entry_lines l on l.journal_entry_id = je.id
    where je.source_table = 'purchase_invoices'
      and je.source_id = '00000000-0000-0000-0000-00000095e001'
      and not je.is_reversal
      and l.chart_of_accounts_id = public.find_account_by_role('anticipos_personal')),
  (select amount from public.employee_account_movements
    where purchase_invoice_id = '00000000-0000-0000-0000-00000095e001'),
  'the employee charge equals what the journal debits to anticipos al personal'
);

select * from finish();
rollback;
