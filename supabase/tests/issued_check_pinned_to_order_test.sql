-- Audit w4-s2 F1: an own check a payment order issued keeps that order,
-- amount, currency and bank account (20261104120200); the order's own edit
-- and cancellation still work. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(8);

insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000b145', '30999999990', 'Proveedor cheque fijo', 'responsable_inscripto');

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000a145', 'Banco cheque fijo', 'bank', 'ARS'),
  ('00000000-0000-0000-0000-00000000a146', 'Otro banco cheque fijo', 'bank', 'ARS');

select public.create_payment_order(
  'jouve_fiscal', 1, 11451, '00000000-0000-0000-0000-00000000b145', current_date, 100, 'ARS', null,
  jsonb_build_array(jsonb_build_object(
    'line_kind', 'issue_check', 'account_id', '00000000-0000-0000-0000-00000000a145', 'amount', 100,
    'issued_check', jsonb_build_object('kind', 'fisico', 'check_number', 'FX-1', 'bank_name', 'Banco FX',
                                       'due_date', current_date))),
  '[]'::jsonb);

set constraints all immediate;
set constraints all deferred;

create temp table t_op on commit drop as
  select id from public.payment_orders
   where channel_id = 'jouve_fiscal' and punto_venta = 1 and numero = 11451;

create temp table t_check on commit drop as
  select ic.id from public.issued_checks ic
   where ic.check_number = 'FX-1' and ic.bank_name = 'Banco FX';

select throws_ok(
  $$update public.issued_checks set payment_order_id = null where id = (select id from t_check)$$,
  '55006',
  'El cheque está ligado a una orden de pago: el monto, la moneda, la cuenta y la OP se cambian editando la orden de pago',
  'an emitted order check cannot drop its order'
);

select throws_ok(
  $$update public.issued_checks set amount = 150 where id = (select id from t_check)$$,
  '55006',
  'El cheque está ligado a una orden de pago: el monto, la moneda, la cuenta y la OP se cambian editando la orden de pago',
  'nor change its amount while emitted'
);

select throws_ok(
  $$update public.issued_checks set bank_account_id = '00000000-0000-0000-0000-00000000a146'
     where id = (select id from t_check)$$,
  '55006',
  'El cheque está ligado a una orden de pago: el monto, la moneda, la cuenta y la OP se cambian editando la orden de pago',
  'nor its bank account'
);

select throws_ok(
  $$update public.issued_checks set currency = 'USD' where id = (select id from t_check)$$,
  '55006',
  'El cheque está ligado a una orden de pago: el monto, la moneda, la cuenta y la OP se cambian editando la orden de pago',
  'nor its currency'
);

select lives_ok(
  $$update public.issued_checks set notes = 'nota', due_date = current_date + 5
     where id = (select id from t_check)$$,
  'it still takes a note and a new due date'
);

select lives_ok(
  $$select public.update_payment_order(
      (select id from t_op), current_date, 120, null,
      jsonb_build_array(jsonb_build_object(
        'line_kind', 'issue_check', 'account_id', '00000000-0000-0000-0000-00000000a146', 'amount', 120,
        'issued_check', jsonb_build_object('kind', 'fisico', 'check_number', 'FX-2', 'bank_name', 'Banco FX',
                                           'due_date', current_date))),
      '[]'::jsonb)$$,
  'the order''s own edit still replaces its check'
);

select lives_ok(
  $$update public.payment_orders set status = 'canceled' where id = (select id from t_op)$$,
  'the order''s cancellation still annuls its check'
);

select results_eq(
  $$select ic.status::text, ic.amount::numeric, ic.payment_order_id
      from public.issued_checks ic
     where ic.check_number = 'FX-2' and ic.bank_name = 'Banco FX'$$,
  $$select 'cancelled'::text, 120::numeric, (select id from t_op)$$,
  'the cancelled check keeps its order and amount'
);

select * from finish();
rollback;
