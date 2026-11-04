-- Audit w5-s2 F1 + F2: an own check is linked to a payment order only by the
-- order's RPCs (20261104123000), and a third-party check changes amount,
-- currency, cartera, receipt or status only through its RPCs
-- (20261104123001). One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f9', 'finance@check-edit-guards.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000000f9', 'finance');

insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000b151', '30999999990', 'Proveedor guardas cheque', 'responsable_inscripto');

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000a151', 'Banco guardas cheque', 'bank', 'ARS'),
  ('00000000-0000-0000-0000-00000000a152', 'Cartera guardas cheque', 'checks', 'ARS'),
  ('00000000-0000-0000-0000-00000000a153', 'Otra cartera guardas cheque', 'checks', 'ARS');

-- Own checks (F1) ---------------------------------------------------------------

-- The order pays from an account: it has no own check.
select lives_ok(
  $$select public.create_payment_order(
      'jouve_fiscal', 1, 11511, '00000000-0000-0000-0000-00000000b151', current_date, 100, 'ARS', null,
      jsonb_build_array(jsonb_build_object(
        'line_kind', 'account', 'account_id', '00000000-0000-0000-0000-00000000a151', 'amount', 100)),
      '[]'::jsonb)$$,
  'a payment order paid from an account is created'
);

set constraints all immediate;
set constraints all deferred;

create temp table t_op on commit drop as
  select id from public.payment_orders
   where channel_id = 'jouve_fiscal' and punto_venta = 1 and numero = 11511;
grant select on t_op to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f9","role":"authenticated"}', true);

select throws_ok(
  $$insert into public.issued_checks
      (kind, check_number, bank_name, issue_date, due_date, amount, currency,
       bank_account_id, payment_order_id, supplier_id)
    values ('fisico', 'GX-1', 'Banco GX', current_date, current_date, 500, 'ARS',
       '00000000-0000-0000-0000-00000000a151', (select id from t_op),
       '00000000-0000-0000-0000-00000000b151')$$,
  '55006',
  'Un cheque propio se liga a una orden de pago solo cargándolo desde la orden de pago',
  'a finance user cannot insert an own check already linked to an order over the API'
);

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select throws_ok(
  $$insert into public.issued_checks
      (kind, check_number, bank_name, issue_date, due_date, amount, currency,
       bank_account_id, payment_order_id)
    values ('fisico', 'GX-2', 'Banco GX', current_date, current_date, 500, 'ARS',
       '00000000-0000-0000-0000-00000000a151', (select id from t_op))$$,
  '55006',
  'Un cheque propio se liga a una orden de pago solo cargándolo desde la orden de pago',
  'not even the table owner'
);

select lives_ok(
  $$insert into public.issued_checks
      (kind, check_number, bank_name, issue_date, due_date, amount, currency,
       bank_account_id, channel_id)
    values ('fisico', 'GX-3', 'Banco GX', current_date, current_date, 40, 'ARS',
       '00000000-0000-0000-0000-00000000a151', 'jouve_fiscal')$$,
  'a hand-loaded own check without an order is still inserted'
);

select lives_ok(
  $$select public.update_payment_order(
      (select id from t_op), current_date, 120, null,
      jsonb_build_array(jsonb_build_object(
        'line_kind', 'issue_check', 'account_id', '00000000-0000-0000-0000-00000000a151', 'amount', 120,
        'issued_check', jsonb_build_object('kind', 'fisico', 'check_number', 'GX-4', 'bank_name', 'Banco GX',
                                           'due_date', current_date))),
      '[]'::jsonb)$$,
  'the order''s own edit still issues a check'
);

select lives_ok(
  $$select public.create_payment_order(
      'jouve_fiscal', 1, 11512, '00000000-0000-0000-0000-00000000b151', current_date, 90, 'ARS', null,
      jsonb_build_array(jsonb_build_object(
        'line_kind', 'issue_check', 'account_id', '00000000-0000-0000-0000-00000000a151', 'amount', 90,
        'issued_check', jsonb_build_object('kind', 'fisico', 'check_number', 'GX-5', 'bank_name', 'Banco GX',
                                           'due_date', current_date))),
      '[]'::jsonb)$$,
  'creating an order still issues its check'
);

set constraints all immediate;
set constraints all deferred;

select results_eq(
  $$select ic.check_number::text, ic.amount::numeric, po.numero::int
      from public.issued_checks ic
      join public.payment_orders po on po.id = ic.payment_order_id
     where ic.bank_name = 'Banco GX'
     order by ic.check_number$$,
  $$values ('GX-4'::text, 120::numeric, 11511), ('GX-5'::text, 90::numeric, 11512)$$,
  'only the orders'' own checks are linked to them'
);

-- Third-party checks (F2) -------------------------------------------------------

insert into public.checks
  (id, kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
   cartera_account_id, status, source_kind, channel_id)
values
  ('00000000-0000-0000-0000-0000000015c1', 'fisico', 'TG-1', 'Banco TG', 'Librador', current_date,
   current_date + 30, 100, 'ARS', '00000000-0000-0000-0000-00000000a152', 'en_cartera', 'manual',
   'jouve_internal');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f9","role":"authenticated"}', true);

select throws_ok(
  $$update public.checks set amount = 150 where id = '00000000-0000-0000-0000-0000000015c1'$$,
  '55006',
  'El monto, la moneda, la cartera, el origen (recibo o cliente) y el estado de un cheque se cambian solo desde sus acciones (depositar, acreditar, rechazar, vender) o desde la orden de pago que lo endosa',
  'a finance user cannot PATCH a cartera check''s amount'
);

select lives_ok(
  $$update public.checks set notes = 'nota', due_date = current_date + 40
     where id = '00000000-0000-0000-0000-0000000015c1'$$,
  'notes and due date are still editable'
);

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select throws_ok(
  $$update public.checks set currency = 'USD' where id = '00000000-0000-0000-0000-0000000015c1'$$,
  '55006',
  null,
  'nor its currency'
);

select throws_ok(
  $$update public.checks set cartera_account_id = '00000000-0000-0000-0000-00000000a153'
     where id = '00000000-0000-0000-0000-0000000015c1'$$,
  '55006',
  null,
  'nor its cartera'
);

select throws_ok(
  $$update public.checks set status = 'depositado' where id = '00000000-0000-0000-0000-0000000015c1'$$,
  '55006',
  null,
  'nor its status'
);

select lives_ok(
  $$select public.deposit_check('00000000-0000-0000-0000-0000000015c1', '00000000-0000-0000-0000-00000000a151',
      current_date, null, null)$$,
  'deposit_check still deposits it'
);

select throws_ok(
  $$update public.checks set status = 'en_cartera' where id = '00000000-0000-0000-0000-0000000015c1'$$,
  '55006',
  null,
  'a deposited check cannot be put back in the cartera by hand'
);

select lives_ok(
  $$select public.credit_check('00000000-0000-0000-0000-0000000015c1', current_date, null)$$,
  'credit_check still credits it'
);

select results_eq(
  $$select status::text, amount::numeric, notes::text
      from public.checks where id = '00000000-0000-0000-0000-0000000015c1'$$,
  $$values ('acreditado'::text, 100::numeric, 'nota'::text)$$,
  'the check went through its RPCs with its amount and the note kept'
);

select ok(
  not has_function_privilege('authenticated', 'public.guard_check_edit()', 'execute')
  and not has_function_privilege('anon', 'public.guard_check_edit()', 'execute'),
  'the guard is not callable from the API'
);

select * from finish();
rollback;
