-- Audit w10-s2 F1-F3, w10-s4 F1-F2 (20261104170000-170002): a payroll
-- payment stays on the entry its insert named; a loan's import run is set
-- only by the importer and never changes; a cuota stays on its loan and a
-- paid cuota keeps its number; a storage run with a live invoice is not
-- deleted. Every legitimate path still works. Run as finance, one
-- transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(26);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000017f1', 'finance@treasury-w10.test'),
  ('00000000-0000-0000-0000-0000000017f2', 'owner@treasury-w10.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000017f1', 'finance'),
  ('00000000-0000-0000-0000-0000000017f2', 'owner');

insert into public.accounts (id, name, type, currency, is_active) values
  ('00000000-0000-0000-0000-0000000017a1', 'Banco w10', 'bank', 'ARS', true);

-- Payroll: two employees with an entry each in the same period.
insert into public.employees (id, legal_name, pay_frequency, hire_date) values
  ('00000000-0000-0000-0000-0000000017e1', 'Empleado w10 A', 'mensual', '2015-03-01'),
  ('00000000-0000-0000-0000-0000000017e2', 'Empleado w10 B', 'mensual', '2016-03-01');
insert into public.payroll_periods (id, year, month) values
  ('00000000-0000-0000-0000-0000000017d1',
   extract(year from current_date)::int, extract(month from current_date)::int);
insert into public.payroll_entries (id, period_id, employee_id, sueldo_neto) values
  ('00000000-0000-0000-0000-0000000017c1', '00000000-0000-0000-0000-0000000017d1',
   '00000000-0000-0000-0000-0000000017e1', 500000),
  ('00000000-0000-0000-0000-0000000017c2', '00000000-0000-0000-0000-0000000017d1',
   '00000000-0000-0000-0000-0000000017e2', 500000);

-- Loans: one loaded by the importer.
create temp table t_run on commit drop as
  select public.commit_import_run(
    'loans', 'prestamos-w10.xlsx', repeat('7', 64), '{}'::jsonb, 1, 0, 0,
    jsonb_build_array(jsonb_build_object(
      'kind', 'prestamo', 'description', 'Préstamo importado w10', 'lender', 'Banco w10',
      'principal', 1000, 'currency', 'ARS', 'channel_id', 'jouve_internal',
      'installments_count', 1, 'first_due_date', '2026-12-10', 'notes', null,
      'installments', jsonb_build_array(
        jsonb_build_object('number', 1, 'due_date', '2026-12-10', 'amount', 1000)))),
    '00000000-0000-0000-0000-0000000017f2') as id;
grant select on t_run to authenticated;

create temp table t_imported on commit drop as
  select id from public.loans where import_run_id = (select id from t_run);
grant select on t_imported to authenticated;

-- Storage: a run linked to a live invoice (s1), a stale pending run whose
-- invoice was issued under its id (s2, the orphan the claim relinks), a
-- pending run with no invoice (s3), and a run whose invoice fails (s4).
insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000017cc01', false, null, 'Cliente almacenaje w10', null);

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000017df01', 'jouve_internal', '00000000-0000-0000-0000-00000017cc01',
   'factura', null, 9001, null, current_date, 2, 99, '0', 300, 0, 300, 'draft', 'storage-w10-i1'),
  ('00000000-0000-0000-0000-00000017df02', 'jouve_internal', '00000000-0000-0000-0000-00000017cc01',
   'factura', null, 9001, null, current_date, 2, 99, '0', 300, 0, 300, 'draft',
   '00000000-0000-0000-0000-00000017ee02'),
  ('00000000-0000-0000-0000-00000017df04', 'jouve_internal', '00000000-0000-0000-0000-00000017cc01',
   'factura', null, 9001, null, current_date, 2, 99, '0', 300, 0, 300, 'draft', 'storage-w10-i4');
insert into public.invoice_items
  (invoice_id, description, quantity, unit_price, iva_rate_id, line_neto, line_iva, line_total)
values
  ('00000000-0000-0000-0000-00000017df01', 'Almacenaje', 1, 300, 3, 300, 0, 300),
  ('00000000-0000-0000-0000-00000017df02', 'Almacenaje', 1, 300, 3, 300, 0, 300),
  ('00000000-0000-0000-0000-00000017df04', 'Almacenaje', 1, 300, 3, 300, 0, 300);

insert into public.storage_billing_runs
  (id, client_id, channel_id, period_start, period_end, total, invoice_id, pending_since)
values
  ('00000000-0000-0000-0000-00000017ee01', '00000000-0000-0000-0000-00000017cc01', 'jouve_internal',
   '1998-01-01', '1998-01-31', 300, '00000000-0000-0000-0000-00000017df01', null),
  ('00000000-0000-0000-0000-00000017ee02', '00000000-0000-0000-0000-00000017cc01', 'jouve_internal',
   '1998-02-01', '1998-02-28', 300, null, now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000017ee03', '00000000-0000-0000-0000-00000017cc01', 'jouve_internal',
   '1998-03-01', '1998-03-31', 300, null, now()),
  ('00000000-0000-0000-0000-00000017ee04', '00000000-0000-0000-0000-00000017cc01', 'jouve_internal',
   '1998-04-01', '1998-04-30', 300, '00000000-0000-0000-0000-00000017df04', null);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000017f1","role":"authenticated"}', true);

-- 1. Payroll payment entry ------------------------------------------------------------

insert into public.payroll_payments
  (id, entry_id, account_id, channel_id, amount, method, paid_at)
values
  ('00000000-0000-0000-0000-00000017ab01', '00000000-0000-0000-0000-0000000017c1',
   '00000000-0000-0000-0000-0000000017a1', 'jouve_internal', 300000, 'transferencia', current_date);

select throws_ok(
  $$update public.payroll_payments set entry_id = '00000000-0000-0000-0000-0000000017c2'
     where id = '00000000-0000-0000-0000-00000017ab01'$$,
  '55006',
  'Un pago de sueldo queda en la liquidación en que se cargó: para pagarle a otra, borralo y cargalo de nuevo',
  'a payment is not moved to another employee''s entry'
);

select throws_ok(
  $$update public.payroll_payments set transaction_id = null
     where id = '00000000-0000-0000-0000-00000017ab01'$$,
  '55006',
  'El movimiento de un pago de sueldo lo crea el pago y no se cambia: editá el pago, o borralo y cargalo de nuevo',
  'its movement is still pinned, with the same message'
);

select lives_ok(
  $$update public.payroll_payments
       set amount = 250000, notes = 'corregido', entry_id = entry_id, transaction_id = transaction_id
     where id = '00000000-0000-0000-0000-00000017ab01'$$,
  'the edit form''s columns still change (and a full-row PATCH keeps the links)'
);

-- 2. Loan import run -----------------------------------------------------------------

select is(
  (select count(*)::int from t_imported),
  1,
  'commit_import_run still loads a loan with its run'
);

select throws_ok(
  $$update public.loans set import_run_id = null where id = (select id from t_imported)$$,
  '55006',
  'La importación de la que viene un préstamo no se cambia',
  'an imported loan does not drop its run'
);

create temp table t_loan on commit drop as
  select public.create_loan(
    jsonb_build_object('kind', 'prestamo', 'description', 'Préstamo w10 A', 'lender', 'Banco',
      'principal', 1000, 'currency', 'ARS', 'channel_id', 'jouve_internal',
      'installments_count', 2, 'first_due_date', current_date),
    jsonb_build_array(
      jsonb_build_object('number', 1, 'due_date', current_date, 'amount', 600),
      jsonb_build_object('number', 2, 'due_date', current_date + 30, 'amount', 600))) as id;
grant select on t_loan to authenticated;

create temp table t_loan_d on commit drop as
  select public.create_loan(
    jsonb_build_object('kind', 'prestamo', 'description', 'Préstamo w10 D', 'lender', 'Banco',
      'principal', 500, 'currency', 'ARS', 'channel_id', 'jouve_internal',
      'installments_count', 1, 'first_due_date', current_date),
    jsonb_build_array(
      jsonb_build_object('number', 1, 'due_date', current_date, 'amount', 500))) as id;
grant select on t_loan_d to authenticated;

select throws_ok(
  $$update public.loans set import_run_id = (select id from t_run) where id = (select id from t_loan)$$,
  '55006',
  'La importación de la que viene un préstamo no se cambia',
  'a manual loan is not marked imported'
);

select throws_ok(
  $$insert into public.loans
      (kind, description, principal, currency, channel_id, installments_count, first_due_date, import_run_id)
    values ('prestamo', 'Préstamo w10 falso importado', 100, 'ARS', 'jouve_internal', 1, current_date,
            (select id from t_run))$$,
  '55006',
  'Un préstamo queda marcado como importado solo al importarlo desde «Importar datos»',
  'a loan is not inserted as imported outside the importer'
);

select lives_ok(
  $$insert into public.loans
      (kind, description, principal, currency, channel_id, installments_count, first_due_date)
    values ('prestamo', 'Préstamo w10 directo', 100, 'ARS', 'jouve_internal', 1, current_date)$$,
  'a loan with no run is still inserted'
);

-- 3. Cuota links ------------------------------------------------------------------------

create temp table t_inst on commit drop as
  select i.id, i.number from public.loan_installments i where i.loan_id = (select id from t_loan);
grant select on t_inst to authenticated;

select lives_ok(
  $$select public.pay_loan_installment((select id from t_inst where number = 1), current_date,
      '00000000-0000-0000-0000-0000000017a1', 600)$$,
  'pay_loan_installment still pays a cuota'
);

select throws_ok(
  $$update public.loan_installments set loan_id = (select id from t_loan_d), number = 99
     where id = (select id from t_inst where number = 1)$$,
  '55006',
  'Una cuota no se pasa a otro préstamo',
  'a paid cuota is not moved to another loan'
);

select throws_ok(
  $$update public.loan_installments set loan_id = (select id from t_loan_d), number = 99
     where id = (select id from t_inst where number = 2)$$,
  '55006',
  'Una cuota no se pasa a otro préstamo',
  'nor a pending one'
);

select throws_ok(
  $$update public.loan_installments set number = 99 where id = (select id from t_inst where number = 1)$$,
  '55006',
  'No se puede cambiar el número de una cuota pagada',
  'a paid cuota keeps its number'
);

select throws_ok(
  $$update public.loans set status = 'cancelled' where id = (select id from t_loan)$$,
  '55006',
  null,
  'so the loan with its paid cuota is still not cancelled'
);

select lives_ok(
  $$update public.loan_installments
       set amount = 550, due_date = current_date + 31, notes = 'ajustada',
           loan_id = loan_id, number = number
     where id = (select id from t_inst where number = 2)$$,
  'a pending cuota is still edited (and a full-row PATCH keeps its loan)'
);

select lives_ok(
  $$select public.pay_loan_installment((select id from t_inst where number = 2), current_date,
      '00000000-0000-0000-0000-0000000017a1', 550)$$,
  'paying the last cuota still works'
);

-- 4. Storage run delete -------------------------------------------------------------

select throws_ok(
  $$delete from public.storage_billing_runs where id = '00000000-0000-0000-0000-00000017ee01'$$,
  '55006',
  'El período de almacenaje tiene una factura vigente: para liberarlo, anulala si es interna, o emití una nota de crédito por el total si es fiscal.',
  'a run linked to a live invoice is not deleted'
);

select throws_ok(
  $$delete from public.storage_billing_runs where id = '00000000-0000-0000-0000-00000017ee02'$$,
  '55006',
  null,
  'nor a pending run whose invoice was issued under its id'
);

select lives_ok(
  $$delete from public.storage_billing_runs where id = '00000000-0000-0000-0000-00000017ee03'$$,
  'a pending run with no invoice is still deleted'
);

create temp table t_claim on commit drop as
  select public.claim_storage_billing_period(
    '00000000-0000-0000-0000-00000017cc01', 'jouve_internal', '1998-02-10', '1998-02-20') as id;

select is(
  (select id from t_claim),
  null,
  'the claim over the orphan''s period still claims nothing'
);

select is(
  (select invoice_id from public.storage_billing_runs where id = '00000000-0000-0000-0000-00000017ee02'),
  '00000000-0000-0000-0000-00000017df02'::uuid,
  'and still links the orphan invoice'
);

-- 5. As the table owner -----------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select lives_ok(
  $$update public.invoices set status = 'failed' where id = '00000000-0000-0000-0000-00000017df04'$$,
  'an invoice still fails'
);

select is(
  (select count(*)::int from public.storage_billing_runs where id = '00000000-0000-0000-0000-00000017ee04'),
  0,
  'and release_invoice_billing_links still frees its run'
);

select throws_ok(
  $$delete from public.storage_billing_runs where id = '00000000-0000-0000-0000-00000017ee01'$$,
  '55006',
  null,
  'a run with a live invoice is not deleted even by the table owner'
);

select throws_ok(
  $$update public.loan_installments set loan_id = (select id from t_loan_d)
     where id = (select id from t_inst where number = 1)$$,
  '55006',
  null,
  'nor a cuota moved to another loan'
);

select throws_ok(
  $$update public.loans set import_run_id = null where id = (select id from t_imported)$$,
  '55006',
  null,
  'nor an imported loan''s run dropped'
);

select ok(
  not has_function_privilege('authenticated', 'public.guard_storage_billing_run_delete()', 'execute')
  and not has_function_privilege('anon', 'public.guard_storage_billing_run_delete()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_payroll_payment_transaction()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_loan()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_loan_installment_payment()', 'execute'),
  'the guards are not callable from the API'
);

select * from finish();
rollback;
