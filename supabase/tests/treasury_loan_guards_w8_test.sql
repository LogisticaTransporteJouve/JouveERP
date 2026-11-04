-- Audit w8-s4 F1-F2, w8-s2 F1-F3 and w8-s5 F1 (20261104150000-150003): a
-- receipt or payment-order header is inserted only by its RPC; a cartera
-- moves only with a check (receipt lines, order lines and direct movements);
-- a movement that names its document is written only by that document; a
-- cuota's payment and a loan's disbursement link change only through their
-- RPCs; create_loan writes a loan and its schedule together. Every
-- legitimate path still works. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(47);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000015f1', 'finance@treasury-w8.test'),
  ('00000000-0000-0000-0000-0000000015f2', 'owner@treasury-w8.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000015f1', 'finance'),
  ('00000000-0000-0000-0000-0000000015f2', 'owner');

-- Internal documents need internal counterparties (guard_document_side).
insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000015c1', false, null, 'Cliente guardas w8', null);
insert into public.suppliers (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000015b1', false, null, 'Proveedor guardas w8', null);

insert into public.accounts (id, name, type, currency, is_active) values
  ('00000000-0000-0000-0000-0000000015a1', 'Cartera guardas w8', 'checks', 'ARS', true),
  ('00000000-0000-0000-0000-0000000015a2', 'Echeq guardas w8', 'echeq', 'ARS', true),
  ('00000000-0000-0000-0000-0000000015a3', 'Banco guardas w8', 'bank', 'ARS', true),
  ('00000000-0000-0000-0000-0000000015a4', 'Cartera apertura w8', 'checks', 'ARS', true);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000015f1","role":"authenticated"}', true);

-- Receipts ------------------------------------------------------------------------

select lives_ok(
  $$select public.create_receipt(
      'jouve_internal', 1, 15001, '00000000-0000-0000-0000-0000000015c1', current_date, 100, 'ARS', null,
      jsonb_build_array(jsonb_build_object(
        'account_id', '00000000-0000-0000-0000-0000000015a3', 'amount', 100)),
      '[]'::jsonb, '[]'::jsonb)$$,
  'create_receipt still inserts its header'
);

select lives_ok(
  $$select public.create_receipt(
      'jouve_internal', 1, 15002, '00000000-0000-0000-0000-0000000015c1', current_date, 70, 'ARS', null,
      jsonb_build_array(jsonb_build_object(
        'account_id', '00000000-0000-0000-0000-0000000015a1', 'amount', 70, 'reference', 'W8-1',
        'check', jsonb_build_object('check_number', 'W8-1', 'bank_name', 'Banco W8',
          'drawer_name', 'Firmante', 'due_date', current_date))),
      '[]'::jsonb, '[]'::jsonb)$$,
  'a cartera line with its check still brings the check in'
);

select throws_ok(
  $$select public.create_receipt(
      'jouve_internal', 1, 15003, '00000000-0000-0000-0000-0000000015c1', current_date, 40, 'ARS', null,
      jsonb_build_array(jsonb_build_object(
        'account_id', '00000000-0000-0000-0000-0000000015a1', 'amount', 40)),
      '[]'::jsonb, '[]'::jsonb)$$,
  '23514',
  'Un cobro en una cartera de cheques necesita su cheque: número, banco y fecha de pago',
  'create_receipt refuses a cartera line with no check'
);

select throws_ok(
  $$select public.create_receipt(
      'jouve_internal', 1, 15003, '00000000-0000-0000-0000-0000000015c1', current_date, 40, 'ARS', null,
      jsonb_build_array(jsonb_build_object(
        'account_id', '00000000-0000-0000-0000-0000000015a2', 'amount', 40, 'check', null)),
      '[]'::jsonb, '[]'::jsonb)$$,
  '23514',
  'Un cobro en una cartera de cheques necesita su cheque: número, banco y fecha de pago',
  'nor an echeq line whose check is null'
);

create temp table t_rcpt on commit drop as
  select id, numero from public.receipts
   where channel_id = 'jouve_internal' and punto_venta = 1 and numero in (15001, 15002);
grant select on t_rcpt to authenticated;

select throws_ok(
  $$select public.update_receipt(
      (select id from t_rcpt where numero = 15001), current_date, 100, null,
      jsonb_build_array(jsonb_build_object(
        'account_id', '00000000-0000-0000-0000-0000000015a1', 'amount', 100)),
      '[]'::jsonb, '[]'::jsonb)$$,
  '23514',
  'Un cobro en una cartera de cheques necesita su cheque: número, banco y fecha de pago',
  'update_receipt refuses a cartera line with no check'
);

select lives_ok(
  $$select public.update_receipt(
      (select id from t_rcpt where numero = 15001), current_date, 90, null,
      jsonb_build_array(jsonb_build_object(
        'account_id', '00000000-0000-0000-0000-0000000015a3', 'amount', 90)),
      '[]'::jsonb, '[]'::jsonb)$$,
  'update_receipt still rewrites a bank line'
);

select is(
  (select count(*)::int from public.checks k
    where k.source_receipt_id = (select id from t_rcpt where numero = 15002)
      and k.cartera_account_id = '00000000-0000-0000-0000-0000000015a1'),
  1,
  'the cartera line''s check is in the cartera'
);

-- Payment orders --------------------------------------------------------------------

-- A check loaded by hand: its inflow is written by checks_manual_inflow.
select lives_ok(
  $$insert into public.checks
      (id, kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
       source_kind, source_client_id, cartera_account_id, channel_id)
    values ('00000000-0000-0000-0000-0000000015d1', 'fisico', 'W8-K1', 'Banco W8', 'Firmante',
       current_date, current_date, 30, 'ARS', 'manual', '00000000-0000-0000-0000-0000000015c1',
       '00000000-0000-0000-0000-0000000015a1', 'jouve_internal')$$,
  'a check loaded by hand still goes into the cartera'
);

select is(
  (select count(*)::int from public.transactions
    where manual_check_id = '00000000-0000-0000-0000-0000000015d1'
      and account_id = '00000000-0000-0000-0000-0000000015a1' and kind = 'income'),
  1,
  'and its trigger still writes the cartera inflow'
);

select throws_ok(
  $$select public.create_payment_order(
      'jouve_internal', 1, 15001, '00000000-0000-0000-0000-0000000015b1', current_date, 30, 'ARS', null,
      jsonb_build_array(jsonb_build_object(
        'line_kind', 'account', 'account_id', '00000000-0000-0000-0000-0000000015a1', 'amount', 30)),
      '[]'::jsonb)$$,
  '23514',
  'Una orden de pago saca plata de una cartera de cheques solo endosando un cheque: pagá desde un banco o una caja, o endosá el cheque',
  'create_payment_order refuses a plain line on a cartera'
);

select throws_ok(
  $$select public.create_payment_order(
      'jouve_internal', 1, 15001, '00000000-0000-0000-0000-0000000015b1', current_date, 30, 'ARS', null,
      jsonb_build_array(jsonb_build_object(
        'line_kind', 'issue_check', 'account_id', '00000000-0000-0000-0000-0000000015a2', 'amount', 30,
        'issued_check', jsonb_build_object('kind', 'fisico', 'check_number', 'W8-P1', 'bank_name', 'Banco W8',
                                           'due_date', current_date))),
      '[]'::jsonb)$$,
  '23514',
  'Una orden de pago saca plata de una cartera de cheques solo endosando un cheque: pagá desde un banco o una caja, o endosá el cheque',
  'nor an own check drawn on a cartera'
);

select lives_ok(
  $$select public.create_payment_order(
      'jouve_internal', 1, 15001, '00000000-0000-0000-0000-0000000015b1', current_date, 30, 'ARS', null,
      jsonb_build_array(jsonb_build_object(
        'line_kind', 'endorse_check', 'endorsed_check_id', '00000000-0000-0000-0000-0000000015d1')),
      '[]'::jsonb)$$,
  'create_payment_order still endorses a cartera check'
);

select lives_ok(
  $$select public.create_payment_order(
      'jouve_internal', 1, 15002, '00000000-0000-0000-0000-0000000015b1', current_date, 50, 'ARS', null,
      jsonb_build_array(jsonb_build_object(
        'line_kind', 'account', 'account_id', '00000000-0000-0000-0000-0000000015a3', 'amount', 50)),
      '[]'::jsonb)$$,
  'and still pays from a bank'
);

create temp table t_op on commit drop as
  select id, numero from public.payment_orders
   where channel_id = 'jouve_internal' and punto_venta = 1 and numero in (15001, 15002);
grant select on t_op to authenticated;

select throws_ok(
  $$select public.update_payment_order(
      (select id from t_op where numero = 15002), current_date, 50, null,
      jsonb_build_array(jsonb_build_object(
        'line_kind', 'account', 'account_id', '00000000-0000-0000-0000-0000000015a1', 'amount', 50)),
      '[]'::jsonb)$$,
  '23514',
  'Una orden de pago saca plata de una cartera de cheques solo endosando un cheque: pagá desde un banco o una caja, o endosá el cheque',
  'update_payment_order refuses a plain line on a cartera'
);

select lives_ok(
  $$select public.update_payment_order(
      (select id from t_op where numero = 15002), current_date, 45, null,
      jsonb_build_array(jsonb_build_object(
        'line_kind', 'account', 'account_id', '00000000-0000-0000-0000-0000000015a3', 'amount', 45)),
      '[]'::jsonb)$$,
  'update_payment_order still rewrites a bank line'
);

select is(
  (select count(*)::int from public.transactions
    where payment_order_id = (select id from t_op where numero = 15001)
      and account_id = '00000000-0000-0000-0000-0000000015a1' and kind = 'expense'),
  1,
  'the endorsement takes the check out of the cartera'
);

-- Own check cashed: the bank outflow is written by its trigger.
select lives_ok(
  $$insert into public.issued_checks
      (id, kind, check_number, bank_name, issue_date, due_date, amount, currency,
       bank_account_id, channel_id)
    values ('00000000-0000-0000-0000-0000000015e1', 'fisico', 'W8-E1', 'Banco W8', current_date, current_date,
       20, 'ARS', '00000000-0000-0000-0000-0000000015a3', 'jouve_internal')$$,
  'an own check is loaded by hand'
);

select lives_ok(
  $$update public.issued_checks set status = 'cashed', cashed_at = current_date
     where id = '00000000-0000-0000-0000-0000000015e1'$$,
  'and cashed'
);

select is(
  (select count(*)::int from public.transactions where issued_check_id = '00000000-0000-0000-0000-0000000015e1'),
  1,
  'its trigger still writes the bank outflow'
);

-- A loose movement in a bank is still written directly.
select lives_ok(
  $$insert into public.transactions
      (id, account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description)
    values
      ('00000000-0000-0000-0000-000000001501', '00000000-0000-0000-0000-0000000015a3', 'jouve_internal',
       'expense', 60, 'ARS', current_date, date_trunc('month', current_date)::date, 'Egreso suelto'),
      ('00000000-0000-0000-0000-000000001502', '00000000-0000-0000-0000-0000000015a3', 'jouve_internal',
       'income', 1000, 'ARS', current_date, date_trunc('month', current_date)::date, 'Ingreso suelto'),
      ('00000000-0000-0000-0000-000000001503', '00000000-0000-0000-0000-0000000015a3', 'jouve_internal',
       'expense', 5, 'ARS', current_date, date_trunc('month', current_date)::date, 'Otro egreso suelto')$$,
  'a loose bank movement is still inserted'
);

-- Loans -------------------------------------------------------------------------------

select lives_ok(
  $$select public.create_loan(
      jsonb_build_object('kind', 'prestamo', 'description', 'Préstamo w8', 'lender', 'Banco W8',
        'principal', 1000, 'currency', 'ARS', 'channel_id', 'jouve_internal',
        'installments_count', 2, 'first_due_date', current_date, 'notes', null),
      jsonb_build_array(
        jsonb_build_object('number', 1, 'due_date', current_date, 'amount', 500),
        jsonb_build_object('number', 2, 'due_date', current_date + 30, 'amount', 500)))$$,
  'create_loan writes a loan with its schedule'
);

create temp table t_loan on commit drop as
  select l.id, l.created_by, l.status::text as status,
         (select count(*)::int from public.loan_installments i
           where i.loan_id = l.id and i.status = 'pendiente') as pending
    from public.loans l where l.description = 'Préstamo w8';
grant select on t_loan to authenticated;

select results_eq(
  $$select created_by, status, pending from t_loan$$,
  $$values ('00000000-0000-0000-0000-0000000015f1'::uuid, 'active'::text, 2)$$,
  'the loan is the caller''s, active, with its two pending cuotas'
);

select throws_ok(
  $$select public.create_loan(
      jsonb_build_object('kind', 'prestamo', 'description', 'Préstamo w8 roto', 'principal', 1000,
        'currency', 'ARS', 'channel_id', 'jouve_internal', 'installments_count', 3,
        'first_due_date', current_date),
      jsonb_build_array(jsonb_build_object('number', 1, 'due_date', current_date, 'amount', 1000)))$$,
  '22023',
  'El cronograma no coincide con la cantidad de cuotas del préstamo',
  'create_loan refuses a schedule of another length'
);

select is(
  (select count(*)::int from public.loans where description = 'Préstamo w8 roto'),
  0,
  'and leaves no loan behind'
);

create temp table t_inst on commit drop as
  select i.id, i.number from public.loan_installments i where i.loan_id = (select id from t_loan);
grant select on t_inst to authenticated;

select lives_ok(
  $$update public.loan_installments set amount = 480, notes = 'ajustada', due_date = current_date + 1
     where id = (select id from t_inst where number = 1)$$,
  'a pending cuota''s amount, date and notes still change directly'
);

select lives_ok(
  $$select public.record_loan_disbursement((select id from t_loan), null, null,
      '00000000-0000-0000-0000-000000001502')$$,
  'record_loan_disbursement still adopts a loose income'
);

select lives_ok(
  $$select public.pay_loan_installment((select id from t_inst where number = 1), current_date,
      '00000000-0000-0000-0000-0000000015a3', 480)$$,
  'pay_loan_installment still pays a cuota'
);

select throws_ok(
  $$select public.pay_loan_installment((select id from t_inst where number = 1), current_date,
      '00000000-0000-0000-0000-0000000015a3', 480)$$,
  '23514',
  'La cuota no existe o ya está pagada',
  'a paid cuota is not paid twice'
);

-- Direct writes, refused even for the table owner -------------------------------------

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select throws_ok(
  $$insert into public.receipts (channel_id, punto_venta, numero, client_id, receipt_date, total_amount, currency, status)
    values ('jouve_internal', 1, 15999, '00000000-0000-0000-0000-0000000015c1', current_date, 5000000, 'ARS', 'issued')$$,
  '55006',
  'Un recibo se carga solo desde Recibos, con sus líneas de cobro: no se puede insertar por fuera',
  'a receipt header is not inserted directly'
);

select throws_ok(
  $$insert into public.payment_orders (channel_id, punto_venta, numero, supplier_id, payment_date, total_amount, currency, status)
    values ('jouve_internal', 1, 15999, '00000000-0000-0000-0000-0000000015b1', current_date, 5000000, 'ARS', 'issued')$$,
  '55006',
  'Una orden de pago se carga solo desde Órdenes de pago, con sus líneas de pago: no se puede insertar por fuera',
  'nor a payment-order header'
);

select throws_ok(
  $$insert into public.transactions
      (account_id, channel_id, kind, amount, currency, transaction_date, accrual_month)
    values ('00000000-0000-0000-0000-0000000015a1', 'jouve_internal', 'expense', 10, 'ARS',
            current_date, date_trunc('month', current_date)::date)$$,
  '55006',
  'Un movimiento en una cartera de cheques, o ligado a un recibo, una orden de pago o un cheque, lo genera solo ese documento: cargalo desde Recibos, Órdenes de pago o Cheques',
  'a movement on a cartera is not inserted directly'
);

select throws_ok(
  $$insert into public.transactions
      (account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, receipt_id)
    values ('00000000-0000-0000-0000-0000000015a3', 'jouve_internal', 'income', 10, 'ARS',
            current_date, date_trunc('month', current_date)::date, (select id from t_rcpt where numero = 15001))$$,
  '55006',
  null,
  'nor one under a receipt'
);

select throws_ok(
  $$insert into public.transactions
      (account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, issued_check_id)
    values ('00000000-0000-0000-0000-0000000015a3', 'jouve_internal', 'expense', 10, 'ARS',
            current_date, date_trunc('month', current_date)::date, '00000000-0000-0000-0000-0000000015e1')$$,
  '55006',
  null,
  'nor one under an own check'
);

select throws_ok(
  $$update public.transactions set payment_order_id = (select id from t_op where numero = 15002)
     where id = '00000000-0000-0000-0000-000000001503'$$,
  '55006',
  null,
  'a loose movement is not moved under a payment order'
);

select throws_ok(
  $$update public.transactions set account_id = '00000000-0000-0000-0000-0000000015a1'
     where id = '00000000-0000-0000-0000-000000001503'$$,
  '55006',
  null,
  'nor onto a cartera'
);

select throws_ok(
  $$insert into public.loan_installments (loan_id, number, due_date, amount, status, paid_date, paid_amount)
    values ((select id from t_loan), 3, current_date, 10, 'pagada', current_date, 10)$$,
  '55006',
  'Una cuota se carga pendiente: se paga después con «Pagar» o «Usar un egreso ya cargado»',
  'a cuota is not inserted paid'
);

select throws_ok(
  $$update public.loan_installments set status = 'pagada', paid_date = current_date, paid_amount = 500
     where id = (select id from t_inst where number = 2)$$,
  '55006',
  'El estado, la fecha y el importe pagados y el movimiento de una cuota se cambian solo pagándola («Pagar» o «Usar un egreso ya cargado»)',
  'a pending cuota is not marked paid directly'
);

select throws_ok(
  $$update public.loan_installments set transaction_id = '00000000-0000-0000-0000-000000001503'
     where id = (select id from t_inst where number = 2)$$,
  '55006',
  null,
  'nor tied to a movement'
);

select throws_ok(
  $$update public.loan_installments set status = 'pendiente', paid_date = null, paid_amount = null
     where id = (select id from t_inst where number = 1)$$,
  '55006',
  null,
  'a paid cuota does not go back to pending'
);

select lives_ok(
  $$select public.adopt_loan_installment_payment((select id from t_inst where number = 2),
      '00000000-0000-0000-0000-000000001501')$$,
  'adopt_loan_installment_payment still adopts a loose expense'
);

select results_eq(
  $$select status::text, paid_amount::numeric, transaction_id from public.loan_installments
     where id = (select id from t_inst where number = 2)$$,
  $$values ('pagada'::text, 60::numeric, '00000000-0000-0000-0000-000000001501'::uuid)$$,
  'the adopted expense pays the second cuota'
);

-- A loan with nothing recorded, for the disbursement link.
insert into public.loans (id, channel_id, currency, description, first_due_date, installments_count, kind, principal)
values ('00000000-0000-0000-0000-0000000015b9', 'jouve_internal', 'ARS', 'Préstamo w8 sin desembolso',
        current_date, 1, 'prestamo', 5);

select throws_ok(
  $$update public.loans set disbursement_transaction_id = '00000000-0000-0000-0000-000000001503'
     where id = '00000000-0000-0000-0000-0000000015b9'$$,
  '55006',
  'El desembolso de un préstamo se registra solo con «Registrar desembolso»',
  'a loan''s disbursement link is not set directly'
);

select throws_ok(
  $$insert into public.loans (channel_id, currency, description, first_due_date, installments_count, kind,
                              principal, disbursement_transaction_id)
    values ('jouve_internal', 'ARS', 'Préstamo w8 con link', current_date, 1, 'prestamo', 5,
            '00000000-0000-0000-0000-000000001503')$$,
  '55006',
  'El desembolso de un préstamo se registra solo con «Registrar desembolso»',
  'nor inserted with one'
);

select throws_ok(
  $$update public.loans set disbursement_transaction_id = null where id = (select id from t_loan)$$,
  '55006',
  'El desembolso registrado de un préstamo no se puede cambiar',
  'a recorded disbursement still cannot change'
);

-- The owner's opening adjustment still reaches any account.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000015f2","role":"authenticated"}', true);
select lives_ok(
  $$select public.apply_account_opening_balance('00000000-0000-0000-0000-0000000015a4', current_date,
      25, 'jouve_internal', null)$$,
  'apply_account_opening_balance still adjusts a cartera'
);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select ok(
  not has_function_privilege('authenticated', 'public.guard_document_insert()', 'execute')
  and not has_function_privilege('anon', 'public.guard_document_insert()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_loan_installment_payment()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_payment_order_line_cartera()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_transaction_origin()', 'execute')
  and not has_function_privilege('anon', 'public.guard_transaction_origin()', 'execute'),
  'the guards are not callable from the API'
);

select ok(
  has_function_privilege('authenticated', 'public.create_loan(jsonb, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.create_loan(jsonb, jsonb)', 'execute'),
  'create_loan is callable by signed-in users only'
);

select * from finish();
rollback;
