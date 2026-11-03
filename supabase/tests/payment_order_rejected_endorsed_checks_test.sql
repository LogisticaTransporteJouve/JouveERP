-- Auditoría W1 · S2 F1: a third-party check endorsed by a payment order and
-- then rejected never goes back to cartera when the order is cancelled or
-- edited; a check still endorsed does. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f9', 'finance@op-rejected-endorsed.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000000f9', 'finance');

insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000b931', '30999999990', 'Proveedor Endosos', 'responsable_inscripto');

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000a931', 'Cartera endosos', 'checks', 'ARS'),
  ('00000000-0000-0000-0000-00000000a932', 'Banco endosos', 'bank', 'ARS');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f9","role":"authenticated"}', true);

insert into public.checks
  (id, kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
   source_kind, cartera_account_id, channel_id)
values
  ('00000000-0000-0000-0000-0000000093c1', 'fisico', 'OPE-REJ', 'Banco X', 'Firmante', current_date, current_date, 40, 'ARS',
   'manual', '00000000-0000-0000-0000-00000000a931', 'jouve_fiscal'),
  ('00000000-0000-0000-0000-0000000093c2', 'fisico', 'OPE-OK', 'Banco X', 'Firmante', current_date, current_date, 25, 'ARS',
   'manual', '00000000-0000-0000-0000-00000000a931', 'jouve_fiscal');

-- Order A endorses the check the bank will reject; order B one that stays endorsed.
select public.create_payment_order(
  'jouve_fiscal', 1, 9931, '00000000-0000-0000-0000-00000000b931', current_date, 40, 'ARS', null,
  jsonb_build_array(jsonb_build_object(
    'line_kind', 'endorse_check', 'endorsed_check_id', '00000000-0000-0000-0000-0000000093c1')),
  '[]'::jsonb);
select public.create_payment_order(
  'jouve_fiscal', 1, 9932, '00000000-0000-0000-0000-00000000b931', current_date, 25, 'ARS', null,
  jsonb_build_array(jsonb_build_object(
    'line_kind', 'endorse_check', 'endorsed_check_id', '00000000-0000-0000-0000-0000000093c2')),
  '[]'::jsonb);

set constraints all immediate;
set constraints all deferred;

select public.reject_check('00000000-0000-0000-0000-0000000093c1', null, current_date, null, null);

create temp table t_op on commit drop as
  select id, numero from public.payment_orders
   where channel_id = 'jouve_fiscal' and punto_venta = 1 and numero in (9931, 9932);

reset role;

select throws_ok(
  $$update public.payment_orders set status = 'canceled'
     where id = (select id from t_op where numero = 9931)$$,
  '55006',
  'No se puede anular la orden de pago: un cheque de terceros que endosó fue rechazado. Gestioná el rechazo con el proveedor primero.',
  'an order whose endorsed check was rejected cannot be cancelled'
);

select throws_ok(
  $$select public.update_payment_order(
      (select id from t_op where numero = 9931), current_date, 40, 'solo la nota',
      jsonb_build_array(jsonb_build_object(
        'line_kind', 'endorse_check', 'endorsed_check_id', '00000000-0000-0000-0000-0000000093c1')),
      '[]'::jsonb)$$,
  '55006',
  'No se puede editar la OP: un cheque de terceros que endosó fue rechazado. Gestioná el rechazo con el proveedor primero.',
  'an order whose endorsed check was rejected cannot be edited'
);

update public.payment_orders set status = 'canceled'
 where id = (select id from t_op where numero = 9932);

select is(
  (select status from public.checks where id = '00000000-0000-0000-0000-0000000093c1'),
  'rechazado',
  'the rejected check stays rejected'
);

select is(
  (select count(*)::int from public.check_movements
    where check_id = '00000000-0000-0000-0000-0000000093c1' and event = 'endorsed'),
  1,
  'the rejected check keeps its endorsement in the history'
);

select is(
  (select status from public.payment_orders where id = (select id from t_op where numero = 9931)),
  'issued',
  'the order with the rejected check stays issued'
);

select is(
  (select status from public.checks where id = '00000000-0000-0000-0000-0000000093c2'),
  'en_cartera',
  'cancelling an order puts a check still endorsed back in cartera'
);

select is(
  (select count(*)::int from public.check_movements
    where check_id = '00000000-0000-0000-0000-0000000093c2' and event = 'endorsed'),
  0,
  'the check back in cartera loses its endorsement'
);

select * from finish();
rollback;
