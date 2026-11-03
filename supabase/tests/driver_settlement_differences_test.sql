-- Follow-up of 4.5: a confirmed rendición's difference goes to the driver's
-- employee account on request (short = charge, over = payment), once; the
-- movement is owned by the rendición (no hand edit or delete) and leaves
-- with it when it is cancelled. A receipt cancelled or edited in Recibos
-- blocks posting. One transaction, rolled back.

begin;

select plan(14);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000046a1', 'finance@rendicion-dif.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000046a1', 'finance');

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000046c1', false, null, 'Cliente Dif', null);
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000000046b1', 'Caja Dif Test', 'cash', 'ARS');
insert into public.employees (id, legal_name, pay_frequency, base_salary, hire_date) values
  ('00000000-0000-0000-0000-0000000046f9', 'Chofer Empleado', 'mensual', 1000, '2090-01-01');
insert into public.drivers (id, full_name, employee_id) values
  ('00000000-0000-0000-0000-0000000046e1', 'Chofer Con Legajo', '00000000-0000-0000-0000-0000000046f9'),
  ('00000000-0000-0000-0000-0000000046e2', 'Chofer Sin Legajo', null);
insert into public.trips (id, trip_date, driver_id) values
  ('00000000-0000-0000-0000-0000000046f1', '2026-11-01', '00000000-0000-0000-0000-0000000046e1'),
  ('00000000-0000-0000-0000-0000000046f2', '2026-11-01', '00000000-0000-0000-0000-0000000046e2');
insert into public.shipments
  (id, client_id, trip_id, remito_number, status, delivery_date, cod_amount)
values
  ('00000000-0000-0000-0000-0000000046d1', '00000000-0000-0000-0000-0000000046c1', '00000000-0000-0000-0000-0000000046f1', 'D-1', 'delivered', '2026-11-01', 1000),
  ('00000000-0000-0000-0000-0000000046d2', '00000000-0000-0000-0000-0000000046c1', '00000000-0000-0000-0000-0000000046f1', 'D-2', 'delivered', '2026-11-01', 500),
  ('00000000-0000-0000-0000-0000000046d3', '00000000-0000-0000-0000-0000000046c1', '00000000-0000-0000-0000-0000000046f2', 'D-3', 'delivered', '2026-11-01', 300);

create function pg_temp.items(p_shipment text, p_amounts numeric[])
returns jsonb language sql as $f$
  select jsonb_build_array(jsonb_build_object(
    'shipment_id', p_shipment,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                 'account_id', '00000000-0000-0000-0000-0000000046b1', 'amount', a)), '[]'::jsonb)
                from unnest(p_amounts) a)))
$f$;

-- D-1: two lines (600 + 300 → 100 short); D-2 exact. Net: 100 short.
create temp table t_ds on commit drop as
select public.save_driver_settlement(
  '00000000-0000-0000-0000-0000000046e1', '2026-11-03', null,
  pg_temp.items('00000000-0000-0000-0000-0000000046d1', array[600, 300])
  || pg_temp.items('00000000-0000-0000-0000-0000000046d2', array[500]),
  '00000000-0000-0000-0000-0000000046a1') as id;

select is(
  (select count(*)::int from public.driver_settlement_lines l
     join public.driver_settlement_items i on i.id = l.item_id
    where i.settlement_id = (select id from t_ds)),
  3, 'a carga keeps several payment lines');

select ok(
  has_function_privilege('service_role', 'public.post_driver_settlement_difference(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.post_driver_settlement_difference(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.unpost_driver_settlement_difference(uuid)', 'execute'),
  'only the service role posts a difference'
);

select throws_ok(
  format($$select public.post_driver_settlement_difference(%L, null)$$, (select id from t_ds)),
  '55006', 'Solo se asienta la diferencia de una rendición confirmada.',
  'a draft posts nothing'
);

create temp table t_receipts on commit drop as
select unnest(public.confirm_driver_settlement(
  (select id from t_ds), '00000000-0000-0000-0000-0000000046a1')) as id;

create temp table t_mov on commit drop as
select public.post_driver_settlement_difference(
  (select id from t_ds), '00000000-0000-0000-0000-0000000046a1') as id;

select results_eq(
  $$select employee_id, kind, amount, currency, creditor
      from public.employee_account_movements where id = (select id from t_mov)$$,
  $$values ('00000000-0000-0000-0000-0000000046f9'::uuid, 'charge'::text, 100::numeric,
            'ARS'::text, 'empresa'::text)$$,
  'a shortfall is a charge to the driver''s employee'
);
select is(
  (select balance from public.v_employee_account_balances
    where employee_id = '00000000-0000-0000-0000-0000000046f9' and currency = 'ARS'),
  100::numeric, 'the employee owes the shortfall'
);
select is(
  public.post_driver_settlement_difference((select id from t_ds), null),
  (select id from t_mov), 'posting again returns the same movement'
);
select is(
  (select count(*)::int from public.employee_account_movements
    where driver_settlement_id = (select id from t_ds)),
  1, 'and writes nothing twice'
);

select throws_ok(
  $$update public.employee_account_movements set amount = 1
     where id = (select id from t_mov)$$,
  '55006', null,
  'the amount is not edited by hand'
);
select throws_ok(
  $$delete from public.employee_account_movements where id = (select id from t_mov)$$,
  '55006', 'La diferencia de una rendición se asienta o se quita desde la rendición',
  'the movement is not deleted by hand'
);
select throws_ok(
  $$select public.delete_employee_account_movement((select id from t_mov))$$,
  '55006', 'La diferencia de una rendición se quita desde la rendición',
  'nor from the employee account'
);

-- Cancelling the rendición (after its receipt) takes the movement with it.
update public.receipts set status = 'canceled', canceled_at = now()
 where id in (select id from t_receipts);
select lives_ok(
  format($$select public.cancel_driver_settlement(%L, null)$$, (select id from t_ds)),
  'the rendición is cancelled'
);
select is(
  (select count(*)::int from public.employee_account_movements
    where driver_settlement_id = (select id from t_ds)),
  0, 'and its difference leaves the driver''s account'
);

-- An overage is a payment; a driver without an employee is refused.
create temp table t_ds2 on commit drop as
select public.save_driver_settlement(
  '00000000-0000-0000-0000-0000000046e1', '2026-11-04', null,
  pg_temp.items('00000000-0000-0000-0000-0000000046d1', array[1050]),
  null) as id;
select public.confirm_driver_settlement((select id from t_ds2), null);
select is(
  (select kind || ':' || amount
     from public.employee_account_movements
    where id = public.post_driver_settlement_difference((select id from t_ds2), null)),
  'payment:50.00', 'an overage credits the driver'
);

create temp table t_ds3 on commit drop as
select public.save_driver_settlement(
  '00000000-0000-0000-0000-0000000046e2', '2026-11-04', null,
  pg_temp.items('00000000-0000-0000-0000-0000000046d3', array[250]),
  null) as id;
select public.confirm_driver_settlement((select id from t_ds3), null);
select throws_ok(
  format($$select public.post_driver_settlement_difference(%L, null)$$, (select id from t_ds3)),
  '23514', 'El chofer Chofer Sin Legajo no está vinculado a un empleado: vinculalo en Flota › Choferes.',
  'a driver without an employee has no account to post to'
);

select * from finish();

rollback;
