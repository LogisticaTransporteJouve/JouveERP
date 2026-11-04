-- Audit w7-s2 F1-F3, w7-s4 F1 and N1 (20261104140000-140003): an own check
-- leaves 'emitted' once; a receipt's or payment order's header, payment lines
-- and retentions are written only by its RPCs (and cancelled from anywhere);
-- a check is deposited only into an active bank of its currency and lives
-- only in a cartera account; the 'received' anchor gets its stamps and date
-- from the database. Every legitimate path still works. One transaction,
-- rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(53);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000014f1', 'finance@treasury-guards.test'),
  ('00000000-0000-0000-0000-0000000014f2', 'other@treasury-guards.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000014f1', 'finance');

-- Internal documents need internal counterparties (guard_document_side).
insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000014c1', false, null, 'Cliente guardas tesorería', null),
  ('00000000-0000-0000-0000-0000000014c2', false, null, 'Otro cliente guardas tesorería', null);
insert into public.suppliers (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000014b1', false, null, 'Proveedor guardas tesorería', null),
  ('00000000-0000-0000-0000-0000000014b2', false, null, 'Otro proveedor guardas tesorería', null);

insert into public.accounts (id, name, type, currency, is_active) values
  ('00000000-0000-0000-0000-0000000014a1', 'Cartera guardas tesorería', 'checks', 'ARS', true),
  ('00000000-0000-0000-0000-0000000014a2', 'Otra cartera guardas tesorería', 'checks', 'ARS', true),
  ('00000000-0000-0000-0000-0000000014a3', 'Banco guardas tesorería', 'bank', 'ARS', true),
  ('00000000-0000-0000-0000-0000000014a4', 'Banco USD guardas tesorería', 'bank', 'USD', true),
  ('00000000-0000-0000-0000-0000000014a5', 'Banco cerrado guardas tesorería', 'bank', 'ARS', false),
  ('00000000-0000-0000-0000-0000000014a6', 'Caja guardas tesorería', 'cash', 'ARS', true);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000014f1","role":"authenticated"}', true);

-- Legitimate paths, as a finance user ---------------------------------------------

-- Own checks: emitted → cashed, rejected or cancelled, once.
select lives_ok(
  $$insert into public.issued_checks
      (id, kind, check_number, bank_name, issue_date, due_date, amount, currency,
       bank_account_id, channel_id)
    values
      ('00000000-0000-0000-0000-0000000014e1', 'fisico', 'TG-1', 'Banco TG', current_date, current_date,
       100, 'ARS', '00000000-0000-0000-0000-0000000014a3', 'jouve_internal'),
      ('00000000-0000-0000-0000-0000000014e2', 'fisico', 'TG-2', 'Banco TG', current_date, current_date,
       30, 'ARS', '00000000-0000-0000-0000-0000000014a3', 'jouve_internal')$$,
  'hand-loaded own checks are inserted emitted'
);

select lives_ok(
  $$update public.issued_checks set status = 'cashed', cashed_at = current_date
     where id = '00000000-0000-0000-0000-0000000014e1' and status = 'emitted'$$,
  'an emitted own check is cashed'
);

select lives_ok(
  $$update public.issued_checks set status = 'cancelled', cancelled_at = now(),
       cancelled_by = '00000000-0000-0000-0000-0000000014f1'
     where id = '00000000-0000-0000-0000-0000000014e2' and status = 'emitted'$$,
  'an emitted own check is annulled'
);

select lives_ok(
  $$update public.issued_checks set notes = 'nota' where id = '00000000-0000-0000-0000-0000000014e1'$$,
  'a cashed check''s notes still change'
);

select lives_ok(
  $$select public.create_payment_order(
      'jouve_internal', 1, 14001, '00000000-0000-0000-0000-0000000014b1', current_date, 100, 'ARS', null,
      jsonb_build_array(jsonb_build_object(
        'line_kind', 'issue_check', 'account_id', '00000000-0000-0000-0000-0000000014a3', 'amount', 100,
        'issued_check', jsonb_build_object('kind', 'fisico', 'check_number', 'TG-3', 'bank_name', 'Banco TG',
                                           'due_date', current_date))),
      '[]'::jsonb)$$,
  'create_payment_order still issues an own check'
);

select lives_ok(
  $$update public.issued_checks set status = 'rejected', rejected_at = current_date
     where check_number = 'TG-3' and bank_name = 'Banco TG' and status = 'emitted'$$,
  'an order''s own check bounces'
);

select lives_ok(
  $$select public.create_payment_order(
      'jouve_internal', 1, 14002, '00000000-0000-0000-0000-0000000014b1', current_date, 40, 'ARS', null,
      jsonb_build_array(jsonb_build_object(
        'line_kind', 'issue_check', 'account_id', '00000000-0000-0000-0000-0000000014a3', 'amount', 40,
        'issued_check', jsonb_build_object('kind', 'fisico', 'check_number', 'TG-4', 'bank_name', 'Banco TG',
                                           'due_date', current_date))),
      '[]'::jsonb)$$,
  'a second order issues another own check'
);

select lives_ok(
  $$update public.payment_orders set status = 'canceled', canceled_at = now()
     where channel_id = 'jouve_internal' and punto_venta = 1 and numero = 14002$$,
  'an order is cancelled (issued → canceled)'
);

select is(
  (select status from public.issued_checks where check_number = 'TG-4' and bank_name = 'Banco TG'),
  'cancelled',
  'the cancellation still annuls its emitted check'
);

-- Payment orders: create, edit, cancel.
select lives_ok(
  $$select public.create_payment_order(
      'jouve_internal', 1, 14003, '00000000-0000-0000-0000-0000000014b1', current_date, 100, 'ARS', null,
      jsonb_build_array(jsonb_build_object(
        'line_kind', 'account', 'account_id', '00000000-0000-0000-0000-0000000014a3', 'amount', 100)),
      '[]'::jsonb)$$,
  'create_payment_order still writes its header and lines'
);

create temp table t_op on commit drop as
  select id, numero from public.payment_orders
   where channel_id = 'jouve_internal' and punto_venta = 1 and numero in (14002, 14003);
grant select on t_op to authenticated;

select lives_ok(
  $$select public.update_payment_order(
      (select id from t_op where numero = 14003), current_date - 1, 80, 'editada',
      jsonb_build_array(jsonb_build_object(
        'line_kind', 'account', 'account_id', '00000000-0000-0000-0000-0000000014a3', 'amount', 80)),
      '[]'::jsonb)$$,
  'update_payment_order still rewrites its date, total and lines'
);

select results_eq(
  $$select po.total_amount::numeric, po.payment_date,
           (select count(*)::int from public.payment_order_payment_lines l where l.payment_order_id = po.id)
      from public.payment_orders po where po.id = (select id from t_op where numero = 14003)$$,
  $$values (80::numeric, current_date - 1, 1)$$,
  'the edited order has the new total, date and line'
);

select lives_ok(
  $$update public.payment_orders set notes = 'nota libre'
     where id = (select id from t_op where numero = 14003)$$,
  'an order''s notes still change directly'
);

-- Receipts: create, edit with retentions, cancel.
select lives_ok(
  $$select public.create_receipt(
      'jouve_internal', 1, 14001, '00000000-0000-0000-0000-0000000014c1', current_date, 100, 'ARS', null,
      jsonb_build_array(jsonb_build_object(
        'account_id', '00000000-0000-0000-0000-0000000014a3', 'amount', 100)),
      '[]'::jsonb, '[]'::jsonb)$$,
  'create_receipt still writes its header and lines'
);

select lives_ok(
  $$select public.create_receipt(
      'jouve_internal', 1, 14002, '00000000-0000-0000-0000-0000000014c1', current_date, 50, 'ARS', null,
      jsonb_build_array(jsonb_build_object(
        'account_id', '00000000-0000-0000-0000-0000000014a3', 'amount', 50)),
      '[]'::jsonb, '[]'::jsonb)$$,
  'a second receipt is created'
);

create temp table t_rcpt on commit drop as
  select id, numero from public.receipts
   where channel_id = 'jouve_internal' and punto_venta = 1 and numero in (14001, 14002);
grant select on t_rcpt to authenticated;

select lives_ok(
  $$select public.update_receipt(
      (select id from t_rcpt where numero = 14001), current_date - 1, 120, null,
      jsonb_build_array(jsonb_build_object(
        'account_id', '00000000-0000-0000-0000-0000000014a3', 'amount', 100)),
      '[]'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'kind', 'retencion', 'tax_type', 'iibb', 'certificate_number', 'TG-R1',
        'certificate_date', current_date, 'amount', 20)))$$,
  'update_receipt still rewrites its date, total, lines and retentions'
);

select results_eq(
  $$select r.total_amount::numeric, r.receipt_date,
           (select count(*)::int from public.receipt_payment_lines l where l.receipt_id = r.id),
           (select sum(t.amount)::numeric from public.receipt_retentions t where t.receipt_id = r.id)
      from public.receipts r where r.id = (select id from t_rcpt where numero = 14001)$$,
  $$values (120::numeric, current_date - 1, 1, 20::numeric)$$,
  'the edited receipt has the new total, date, line and retention'
);

select lives_ok(
  $$update public.receipts set notes = 'nota libre', notified_at = now()
     where id = (select id from t_rcpt where numero = 14001)$$,
  'a receipt''s notes and notified_at still change directly'
);

select lives_ok(
  $$update public.receipts set status = 'canceled', canceled_at = now()
     where id = (select id from t_rcpt where numero = 14002)$$,
  'a receipt is cancelled (issued → canceled)'
);

-- Third-party checks: loaded into a cartera, anchored, deposited into a bank.
select lives_ok(
  $$insert into public.checks
      (id, kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
       source_kind, source_client_id, cartera_account_id, channel_id)
    values ('00000000-0000-0000-0000-0000000014d1', 'fisico', 'TG-K1', 'Banco TG', 'Firmante',
       current_date, current_date, 60, 'ARS', 'manual', '00000000-0000-0000-0000-0000000014c1',
       '00000000-0000-0000-0000-0000000014a1', 'jouve_internal')$$,
  'a hand-loaded check goes into a cartera account'
);

select lives_ok(
  $$insert into public.check_movements (check_id, event, event_date, created_at, created_by)
    values ('00000000-0000-0000-0000-0000000014d1', 'received', '2001-01-01', '2999-01-01',
            '00000000-0000-0000-0000-0000000014f2')$$,
  'its received anchor is inserted'
);

select results_eq(
  $$select created_at = now(), created_by, event_date from public.check_movements
     where check_id = '00000000-0000-0000-0000-0000000014d1' and event = 'received'$$,
  $$values (true, '00000000-0000-0000-0000-0000000014f1'::uuid, current_date)$$,
  'the anchor is stamped now, by the caller, on the check''s issue date'
);

select throws_ok(
  $$select public.deposit_check('00000000-0000-0000-0000-0000000014d1', '00000000-0000-0000-0000-0000000014a2',
      current_date, null, null)$$,
  '23514',
  'Un cheque se deposita en una cuenta bancaria, no en una cartera de cheques, caja o billetera.',
  'a check is not deposited into another cartera'
);

select throws_ok(
  $$select public.deposit_check('00000000-0000-0000-0000-0000000014d1', '00000000-0000-0000-0000-0000000014a1',
      current_date, null, null)$$,
  '23514',
  'Un cheque se deposita en una cuenta bancaria, no en una cartera de cheques, caja o billetera.',
  'nor into its own cartera'
);

select throws_ok(
  $$select public.deposit_check('00000000-0000-0000-0000-0000000014d1', '00000000-0000-0000-0000-0000000014a6',
      current_date, null, null)$$,
  '23514',
  'Un cheque se deposita en una cuenta bancaria, no en una cartera de cheques, caja o billetera.',
  'nor into a cash account'
);

select throws_ok(
  $$select public.deposit_check('00000000-0000-0000-0000-0000000014d1', '00000000-0000-0000-0000-0000000014a5',
      current_date, null, null)$$,
  '23514',
  'La cuenta destino no existe o está inactiva.',
  'nor into an inactive bank'
);

select throws_ok(
  $$select public.deposit_check('00000000-0000-0000-0000-0000000014d1', '00000000-0000-0000-0000-0000000014a4',
      current_date, null, null)$$,
  '23514',
  'La cuenta bancaria es de otra moneda que el cheque.',
  'nor into a bank of another currency'
);

select lives_ok(
  $$select public.deposit_check('00000000-0000-0000-0000-0000000014d1', '00000000-0000-0000-0000-0000000014a3',
      current_date, null, null)$$,
  'deposit_check still deposits it into an active bank of its currency'
);

select results_eq(
  $$select k.status::text,
           (select count(*)::int from public.transactions t
             where t.account_id = '00000000-0000-0000-0000-0000000014a2')
      from public.checks k where k.id = '00000000-0000-0000-0000-0000000014d1'$$,
  $$values ('depositado'::text, 0)$$,
  'the check is deposited and the other cartera never moved'
);

-- Direct writes, refused even for the table owner ------------------------------------

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Own checks.
select throws_ok(
  $$insert into public.issued_checks
      (kind, check_number, bank_name, issue_date, due_date, amount, currency, bank_account_id,
       channel_id, status, cashed_at)
    values ('fisico', 'TG-X1', 'Banco TG', current_date, current_date, 10, 'ARS',
       '00000000-0000-0000-0000-0000000014a3', 'jouve_internal', 'cashed', current_date)$$,
  '55006',
  'Un cheque propio se carga emitido: el cobro, el rechazo o la anulación se registran después desde el cheque',
  'an own check is not inserted already cashed'
);

select throws_ok(
  $$update public.issued_checks set status = 'emitted', cashed_at = null
     where id = '00000000-0000-0000-0000-0000000014e1'$$,
  '55006',
  'El cheque ya no está emitido: se cobró, se rechazó o se anuló, y ese estado no se cambia',
  'a cashed check does not go back to emitted'
);

select throws_ok(
  $$update public.issued_checks set status = 'rejected', rejected_at = current_date, cashed_at = null
     where id = '00000000-0000-0000-0000-0000000014e1'$$,
  '55006',
  null,
  'nor from cashed to rejected'
);

select throws_ok(
  $$update public.issued_checks set status = 'emitted', rejected_at = null
     where check_number = 'TG-3' and bank_name = 'Banco TG'$$,
  '55006',
  null,
  'a rejected check does not go back to emitted'
);

select throws_ok(
  $$update public.issued_checks set status = 'emitted', cancelled_at = null, cancelled_by = null
     where id = '00000000-0000-0000-0000-0000000014e2'$$,
  '55006',
  null,
  'nor an annulled one'
);

select is(
  (select count(*)::int from public.transactions where issued_check_id = '00000000-0000-0000-0000-0000000014e1'),
  1,
  'the cashed check keeps one bank outflow'
);

-- Receipt headers, lines and retentions.
select throws_ok(
  $$update public.receipts set total_amount = 500 where id = (select id from t_rcpt where numero = 14001)$$,
  '55006',
  'El monto, la moneda, la cotización, el cliente, el canal, la fecha y el número de un recibo se cambian solo editando el recibo',
  'a receipt''s total is not PATCHed'
);

select throws_ok(
  $$update public.receipts set client_id = '00000000-0000-0000-0000-0000000014c2'
     where id = (select id from t_rcpt where numero = 14001)$$,
  '55006',
  null,
  'nor its client'
);

select throws_ok(
  $$update public.receipts set receipt_date = current_date - 30
     where id = (select id from t_rcpt where numero = 14001)$$,
  '55006',
  null,
  'nor its date'
);

select throws_ok(
  $$update public.receipts set status = 'issued', canceled_at = null
     where id = (select id from t_rcpt where numero = 14002)$$,
  '55006',
  'Un documento anulado no se vuelve a emitir: cargá uno nuevo',
  'a cancelled receipt is not issued again'
);

select throws_ok(
  $$insert into public.receipt_payment_lines (receipt_id, account_id, amount)
    values ((select id from t_rcpt where numero = 14001), '00000000-0000-0000-0000-0000000014a3', 5)$$,
  '55006',
  'Las líneas de cobro y las retenciones de un recibo se escriben solo desde el recibo: editalo o anulalo',
  'a receipt line is not inserted directly'
);

select throws_ok(
  $$update public.receipt_payment_lines set amount = 1
     where receipt_id = (select id from t_rcpt where numero = 14001)$$,
  '55006',
  null,
  'nor updated'
);

select throws_ok(
  $$delete from public.receipt_payment_lines where receipt_id = (select id from t_rcpt where numero = 14001)$$,
  '55006',
  null,
  'nor deleted'
);

select throws_ok(
  $$insert into public.receipt_retentions
      (receipt_id, kind, tax_type, certificate_number, certificate_date, amount)
    values ((select id from t_rcpt where numero = 14001), 'retencion', 'ganancias', 'TG-R2', current_date, 5)$$,
  '55006',
  null,
  'a retention is not inserted directly'
);

select throws_ok(
  $$delete from public.receipt_retentions where receipt_id = (select id from t_rcpt where numero = 14001)$$,
  '55006',
  null,
  'nor deleted'
);

-- Payment order headers and lines.
select throws_ok(
  $$update public.payment_orders set total_amount = 1 where id = (select id from t_op where numero = 14003)$$,
  '55006',
  'El monto, la moneda, la cotización, el proveedor, el canal, la fecha y el número de una orden de pago se cambian solo editando la orden de pago',
  'an order''s total is not PATCHed'
);

select throws_ok(
  $$update public.payment_orders set supplier_id = '00000000-0000-0000-0000-0000000014b2'
     where id = (select id from t_op where numero = 14003)$$,
  '55006',
  null,
  'nor its supplier'
);

select throws_ok(
  $$update public.payment_orders set status = 'issued', canceled_at = null
     where id = (select id from t_op where numero = 14002)$$,
  '55006',
  'Un documento anulado no se vuelve a emitir: cargá uno nuevo',
  'a cancelled order is not issued again'
);

select throws_ok(
  $$insert into public.payment_order_payment_lines (payment_order_id, account_id, amount)
    values ((select id from t_op where numero = 14003), '00000000-0000-0000-0000-0000000014a3', 1)$$,
  '55006',
  'Las líneas de pago de una orden de pago se escriben solo desde la orden de pago: editala o anulala',
  'an order line is not inserted directly'
);

select throws_ok(
  $$update public.payment_order_payment_lines set amount = 9999999
     where payment_order_id = (select id from t_op where numero = 14003)$$,
  '55006',
  null,
  'nor its amount updated'
);

select throws_ok(
  $$update public.payment_order_payment_lines set payment_order_id = (select id from t_op where numero = 14002)
     where payment_order_id = (select id from t_op where numero = 14003)$$,
  '55006',
  null,
  'nor moved to another order'
);

select throws_ok(
  $$delete from public.payment_order_payment_lines
     where payment_order_id = (select id from t_op where numero = 14003)$$,
  '55006',
  null,
  'nor deleted'
);

-- Checks.
select throws_ok(
  $$insert into public.checks
      (kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
       source_kind, cartera_account_id, channel_id)
    values ('fisico', 'TG-X2', 'Banco TG', 'Firmante', current_date, current_date, 10, 'ARS',
       'manual', '00000000-0000-0000-0000-0000000014a3', 'jouve_internal')$$,
  '23514',
  'La cuenta de cartera de un cheque tiene que ser una cartera de cheques (físicos o echeq)',
  'a check is not loaded into a bank account as its cartera'
);

select ok(
  not has_function_privilege('authenticated', 'public.guard_document_header()', 'execute')
  and not has_function_privilege('anon', 'public.guard_document_header()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_document_line()', 'execute')
  and not has_function_privilege('anon', 'public.guard_document_line()', 'execute'),
  'the guards are not callable from the API'
);

select * from finish();
rollback;
