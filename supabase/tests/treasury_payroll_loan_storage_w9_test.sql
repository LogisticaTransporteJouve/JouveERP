-- Audit w9-s4 F1-F2, w9-s2 F1 and w9-s5 F1 (20261104160000-160002): a
-- payroll payment's movement is the one its insert created; a paid cuota is
-- not deleted, and a loan's terms and status change only through their
-- paths; a storage period whose invoice lost its link gets that invoice back
-- instead of a second one, and a run links only a live invoice of its
-- client. Every legitimate path still works. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(34);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000016f1', 'finance@treasury-w9.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000016f1', 'finance');

insert into public.accounts (id, name, type, currency, is_active) values
  ('00000000-0000-0000-0000-0000000016a1', 'Banco sueldos w9', 'bank', 'ARS', true),
  ('00000000-0000-0000-0000-0000000016a2', 'Caja w9', 'cash', 'ARS', true);

-- A loose expense another document could own, and a payroll entry.
insert into public.transactions
  (id, account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description)
values
  ('00000000-0000-0000-0000-00000016bb01', '00000000-0000-0000-0000-0000000016a2', 'jouve_internal',
   'expense', 777, 'ARS', current_date, date_trunc('month', current_date)::date, 'Egreso ajeno w9');

insert into public.employees (id, legal_name, pay_frequency, hire_date) values
  ('00000000-0000-0000-0000-0000000016e1', 'Empleado w9', 'mensual', '2015-03-01');
insert into public.payroll_periods (id, year, month) values
  ('00000000-0000-0000-0000-0000000016d1',
   extract(year from current_date)::int, extract(month from current_date)::int);
insert into public.payroll_entries (id, period_id, employee_id, sueldo_neto) values
  ('00000000-0000-0000-0000-0000000016c1', '00000000-0000-0000-0000-0000000016d1',
   '00000000-0000-0000-0000-0000000016e1', 500000);

-- Storage: an Otras ventas client, another one, and three runs left pending
-- an hour ago, each with what its invoice became under the run's id.
insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000016cc01', false, null, 'Cliente almacenaje w9', null),
  ('00000000-0000-0000-0000-00000016cc02', false, null, 'Otro cliente almacenaje w9', null);

insert into public.storage_billing_runs
  (id, client_id, channel_id, period_start, period_end, total, pending_since)
values
  -- r1: its invoice is live (a draft with its items); r2: its draft has no
  -- items (never issued); r3: its invoice failed.
  ('00000000-0000-0000-0000-00000016ee01', '00000000-0000-0000-0000-00000016cc01', 'jouve_internal',
   '1999-01-01', '1999-01-31', 300, now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000016ee02', '00000000-0000-0000-0000-00000016cc01', 'jouve_internal',
   '1999-02-01', '1999-02-28', 300, now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000016ee03', '00000000-0000-0000-0000-00000016cc01', 'jouve_internal',
   '1999-03-01', '1999-03-31', 300, now() - interval '1 hour');

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000016df01', 'jouve_internal', '00000000-0000-0000-0000-00000016cc01',
   'factura', null, 9001, null, current_date, 2, 99, '0', 300, 0, 300, 'draft',
   '00000000-0000-0000-0000-00000016ee01'),
  ('00000000-0000-0000-0000-00000016df02', 'jouve_internal', '00000000-0000-0000-0000-00000016cc01',
   'factura', null, 9001, null, current_date, 2, 99, '0', 300, 0, 300, 'draft',
   '00000000-0000-0000-0000-00000016ee02'),
  ('00000000-0000-0000-0000-00000016df03', 'jouve_internal', '00000000-0000-0000-0000-00000016cc01',
   'factura', null, 9001, null, current_date, 2, 99, '0', 300, 0, 300, 'draft',
   '00000000-0000-0000-0000-00000016ee03'),
  -- i4: a live invoice issued under no run; i5: another client's.
  ('00000000-0000-0000-0000-00000016df04', 'jouve_internal', '00000000-0000-0000-0000-00000016cc01',
   'factura', null, 9001, null, current_date, 2, 99, '0', 300, 0, 300, 'draft', 'storage-w9-i4'),
  ('00000000-0000-0000-0000-00000016df05', 'jouve_internal', '00000000-0000-0000-0000-00000016cc02',
   'factura', null, 9001, null, current_date, 2, 99, '0', 300, 0, 300, 'draft', 'storage-w9-i5');
insert into public.invoice_items
  (invoice_id, description, quantity, unit_price, iva_rate_id, line_neto, line_iva, line_total)
values
  ('00000000-0000-0000-0000-00000016df01', 'Almacenaje', 1, 300, 3, 300, 0, 300),
  ('00000000-0000-0000-0000-00000016df03', 'Almacenaje', 1, 300, 3, 300, 0, 300),
  ('00000000-0000-0000-0000-00000016df04', 'Almacenaje', 1, 300, 3, 300, 0, 300);
update public.invoices set status = 'failed' where id = '00000000-0000-0000-0000-00000016df03';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000016f1","role":"authenticated"}', true);

-- 1. Payroll payment movement ------------------------------------------------------

-- The insert sends someone else's movement: the sync writes its own anyway.
insert into public.payroll_payments
  (id, entry_id, account_id, channel_id, amount, method, paid_at, transaction_id)
values
  ('00000000-0000-0000-0000-00000016ab01', '00000000-0000-0000-0000-0000000016c1',
   '00000000-0000-0000-0000-0000000016a1', 'jouve_internal', 300000, 'transferencia', current_date,
   '00000000-0000-0000-0000-00000016bb01');

select ok(
  (select p.transaction_id is not null
          and p.transaction_id <> '00000000-0000-0000-0000-00000016bb01'
     from public.payroll_payments p where p.id = '00000000-0000-0000-0000-00000016ab01'),
  'a payment''s movement is the one its insert creates'
);

select throws_ok(
  $$update public.payroll_payments set transaction_id = '00000000-0000-0000-0000-00000016bb01'
     where id = '00000000-0000-0000-0000-00000016ab01'$$,
  '55006',
  'El movimiento de un pago de sueldo lo crea el pago y no se cambia: editá el pago, o borralo y cargalo de nuevo',
  'a payment is not pointed at another movement'
);

select throws_ok(
  $$update public.payroll_payments set transaction_id = null
     where id = '00000000-0000-0000-0000-00000016ab01'$$,
  '55006',
  null,
  'nor detached from its own'
);

select lives_ok(
  $$update public.payroll_payments
       set account_id = '00000000-0000-0000-0000-0000000016a2', channel_id = 'jouve_internal',
           amount = 250000, method = 'efectivo', paid_at = current_date, notes = 'corregido',
           transaction_id = transaction_id
     where id = '00000000-0000-0000-0000-00000016ab01'$$,
  'the edit form''s columns still change (and a full-row PATCH keeps the link)'
);

select results_eq(
  $$select t.amount::numeric, t.account_id from public.transactions t
     join public.payroll_payments p on p.transaction_id = t.id
    where p.id = '00000000-0000-0000-0000-00000016ab01'$$,
  $$values (250000::numeric, '00000000-0000-0000-0000-0000000016a2'::uuid)$$,
  'the edit reaches the payment''s own movement'
);

select results_eq(
  $$select amount::numeric from public.transactions where id = '00000000-0000-0000-0000-00000016bb01'$$,
  $$values (777::numeric)$$,
  'the other movement is untouched'
);

create temp table t_pay_tx on commit drop as
  select transaction_id as id from public.payroll_payments
   where id = '00000000-0000-0000-0000-00000016ab01';
grant select on t_pay_tx to authenticated;

select lives_ok(
  $$delete from public.payroll_payments where id = '00000000-0000-0000-0000-00000016ab01'$$,
  'a payment is still deleted'
);

select is(
  (select count(*)::int from public.transactions
    where id in ((select id from t_pay_tx), '00000000-0000-0000-0000-00000016bb01')),
  1,
  'and takes only its own movement with it'
);

-- 2. Loans ----------------------------------------------------------------------------

create temp table t_loan on commit drop as
  select public.create_loan(
    jsonb_build_object('kind', 'prestamo', 'description', 'Préstamo w9', 'lender', 'Banco',
      'principal', 1000, 'currency', 'ARS', 'channel_id', 'jouve_internal',
      'installments_count', 2, 'first_due_date', current_date),
    jsonb_build_array(
      jsonb_build_object('number', 1, 'due_date', current_date, 'amount', 600),
      jsonb_build_object('number', 2, 'due_date', current_date + 30, 'amount', 600))) as id;
grant select on t_loan to authenticated;

create temp table t_inst on commit drop as
  select i.id, i.number from public.loan_installments i where i.loan_id = (select id from t_loan);
grant select on t_inst to authenticated;

select lives_ok(
  $$update public.loans set principal = 1200, currency = 'ARS', channel_id = 'jouve_internal'
     where id = (select id from t_loan)$$,
  'a loan with no money booked still changes its terms'
);

select lives_ok(
  $$select public.record_loan_disbursement((select id from t_loan),
      '00000000-0000-0000-0000-0000000016a1', current_date, null)$$,
  'record_loan_disbursement still records the disbursement'
);

select lives_ok(
  $$select public.pay_loan_installment((select id from t_inst where number = 1), current_date,
      '00000000-0000-0000-0000-0000000016a1', 600)$$,
  'pay_loan_installment still pays a cuota'
);

select throws_ok(
  $$delete from public.loan_installments where id = (select id from t_inst where number = 1)$$,
  '55006',
  'No se puede borrar una cuota pagada: su pago queda en Caja y en el libro diario',
  'a paid cuota is not deleted'
);

select throws_ok(
  $$update public.loans set principal = 5000 where id = (select id from t_loan)$$,
  '55006',
  'El capital, la moneda y el canal de un préstamo no cambian una vez registrado su desembolso o pagada una cuota',
  'a disbursed loan keeps its principal'
);

select throws_ok(
  $$update public.loans set currency = 'USD' where id = (select id from t_loan)$$,
  '55006',
  null,
  'its currency'
);

select throws_ok(
  $$update public.loans set channel_id = 'jouve_fiscal' where id = (select id from t_loan)$$,
  '55006',
  null,
  'and its channel'
);

select throws_ok(
  $$update public.loans set status = 'paid' where id = (select id from t_loan)$$,
  '55006',
  'Un préstamo queda pagado solo al pagar su última cuota, y anulado solo con «Anular»',
  'a loan is not marked paid directly'
);

select lives_ok(
  $$update public.loans set notes = 'refinanciado', description = 'Préstamo w9 (banco)'
     where id = (select id from t_loan)$$,
  'its description and notes still change'
);

select lives_ok(
  $$update public.loan_installments set amount = 550 where id = (select id from t_inst where number = 2)$$,
  'a pending cuota is still edited'
);

select lives_ok(
  $$select public.pay_loan_installment((select id from t_inst where number = 2), current_date,
      '00000000-0000-0000-0000-0000000016a1', 550)$$,
  'paying the last cuota still works'
);

select is(
  (select status::text from public.loans where id = (select id from t_loan)),
  'paid',
  'and marks the loan paid'
);

select throws_ok(
  $$update public.loans set status = 'active' where id = (select id from t_loan)$$,
  '55006',
  'Un préstamo queda pagado solo al pagar su última cuota, y anulado solo con «Anular»',
  'a paid loan does not go back to active'
);

-- A loan with nothing recorded: a pending cuota is deleted, and the loan
-- goes away with the rest of its schedule.
create temp table t_loan2 on commit drop as
  select public.create_loan(
    jsonb_build_object('kind', 'prestamo', 'description', 'Préstamo w9 por error',
      'principal', 100, 'currency', 'ARS', 'channel_id', 'jouve_internal',
      'installments_count', 2, 'first_due_date', current_date),
    jsonb_build_array(
      jsonb_build_object('number', 1, 'due_date', current_date, 'amount', 50),
      jsonb_build_object('number', 2, 'due_date', current_date + 30, 'amount', 50))) as id;
grant select on t_loan2 to authenticated;

select lives_ok(
  $$delete from public.loan_installments where loan_id = (select id from t_loan2) and number = 2$$,
  'a pending cuota is still deleted'
);

select lives_ok(
  $$delete from public.loans where id = (select id from t_loan2)$$,
  'a loan with nothing paid is still deleted with its cuotas'
);

select is(
  (select count(*)::int from public.loan_installments where loan_id = (select id from t_loan2)),
  0,
  'its schedule went with it'
);

-- 3. Storage billing -------------------------------------------------------------------

create temp table t_claim on commit drop as
  select public.claim_storage_billing_period(
    '00000000-0000-0000-0000-00000016cc01', 'jouve_internal', '1999-01-10', '1999-01-20') as id;

select is(
  (select id from t_claim),
  null,
  'a claim over a period whose invoice lost its link claims nothing'
);

select ok(
  (select invoice_id = '00000000-0000-0000-0000-00000016df01' and pending_since is null
     from public.storage_billing_runs where id = '00000000-0000-0000-0000-00000016ee01'),
  'and links that invoice to the period'
);

select is(
  (select count(*)::int from public.storage_billing_runs
    where id in ('00000000-0000-0000-0000-00000016ee02', '00000000-0000-0000-0000-00000016ee03')),
  0,
  'a stale run whose invoice failed or was never issued is freed'
);

select throws_ok(
  $$select public.claim_storage_billing_period(
      '00000000-0000-0000-0000-00000016cc01', 'jouve_internal', '1999-01-15', '1999-01-25')$$,
  '23P01',
  'Ese período ya fue facturado (total o parcialmente) para este cliente en este canal.',
  'the linked period stays billed'
);

create temp table t_claim2 on commit drop as
  select public.claim_storage_billing_period(
    '00000000-0000-0000-0000-00000016cc01', 'jouve_internal', '1999-03-01', '1999-03-31') as id;
grant select on t_claim2 to authenticated;

select isnt(
  (select id from t_claim2),
  null,
  'the freed period is claimed again'
);

select throws_ok(
  $$update public.storage_billing_runs set invoice_id = '00000000-0000-0000-0000-00000016df03'
     where id = (select id from t_claim2)$$,
  '55006',
  'La factura de almacenaje falló o se anuló: volvé a facturar el período.',
  'a run does not link a failed invoice'
);

select throws_ok(
  $$update public.storage_billing_runs set invoice_id = '00000000-0000-0000-0000-00000016df05'
     where id = (select id from t_claim2)$$,
  '23514',
  'La factura no es del cliente del período de almacenaje.',
  'nor another client''s'
);

select lives_ok(
  $$update public.storage_billing_runs
       set invoice_id = '00000000-0000-0000-0000-00000016df04', pending_since = null
     where id = (select id from t_claim2)$$,
  'a run still links a live invoice of its client'
);

-- 4. As the table owner -----------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select throws_ok(
  $$delete from public.loan_installments where id = (select id from t_inst where number = 2)$$,
  '55006',
  null,
  'a paid cuota is not deleted even by the table owner'
);

select ok(
  not has_function_privilege('authenticated', 'public.guard_payroll_payment_transaction()', 'execute')
  and not has_function_privilege('anon', 'public.guard_payroll_payment_transaction()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_storage_billing_run_invoice()', 'execute')
  and not has_function_privilege('anon', 'public.guard_storage_billing_run_invoice()', 'execute')
  and has_function_privilege('authenticated', 'public.claim_storage_billing_period(uuid, text, date, date)', 'execute')
  and not has_function_privilege('anon', 'public.claim_storage_billing_period(uuid, text, date, date)', 'execute'),
  'the guards are not callable from the API; the claim is, by signed-in users'
);

select * from finish();
rollback;
