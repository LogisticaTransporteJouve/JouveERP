-- Follow-up of 4.5 (20261104080000 + 20261104095300): a confirmed
-- rendición's difference is borne by the driver or by the client, never
-- both. 'client' only records the choice (the invoice stays open).
-- 'driver' on a shortfall settles the client's invoice with a receipt and
-- charges the driver an advance from the same cash account. Idempotent,
-- owned by the rendición, taken back by unpost and cancel; without hr:write
-- (p_allow_driver false) neither removes what the driver's account holds.
-- One transaction, rolled back.

begin;

select plan(31);

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

-- D-1's invoice: 1000, the carga's cash-on-delivery amount.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key)
values
  ('00000000-0000-0000-0000-0000000046a9', 'jouve_internal', '00000000-0000-0000-0000-0000000046c1',
   'factura', null, 9001, 99961, current_date, 2, 99, '0', 1000, 0, 1000, 'emitted', 'rend-dif-test-1');

insert into public.shipments
  (id, client_id, trip_id, remito_number, status, delivery_date, cod_amount, invoice_id)
values
  ('00000000-0000-0000-0000-0000000046d1', '00000000-0000-0000-0000-0000000046c1', '00000000-0000-0000-0000-0000000046f1', 'D-1', 'delivered', '2026-11-01', 1000, '00000000-0000-0000-0000-0000000046a9'),
  ('00000000-0000-0000-0000-0000000046d2', '00000000-0000-0000-0000-0000000046c1', '00000000-0000-0000-0000-0000000046f1', 'D-2', 'delivered', '2026-11-01', 500, null),
  ('00000000-0000-0000-0000-0000000046d3', '00000000-0000-0000-0000-0000000046c1', '00000000-0000-0000-0000-0000000046f2', 'D-3', 'delivered', '2026-11-01', 300, null);

create function pg_temp.items(p_shipment text, p_amounts numeric[])
returns jsonb language sql as $f$
  select jsonb_build_array(jsonb_build_object(
    'shipment_id', p_shipment,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                 'account_id', '00000000-0000-0000-0000-0000000046b1', 'amount', a)), '[]'::jsonb)
                from unnest(p_amounts) a)))
$f$;

create function pg_temp.open_d1() returns numeric language sql as $f$
  select public.invoice_open_amount('00000000-0000-0000-0000-0000000046a9')
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
  has_function_privilege('service_role', 'public.post_driver_settlement_difference(uuid, uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.cancel_driver_settlement(uuid, uuid, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.post_driver_settlement_difference(uuid, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.unpost_driver_settlement_difference(uuid, uuid, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.cancel_driver_settlement(uuid, uuid, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.remove_driver_settlement_difference(uuid, uuid, boolean)', 'execute')
  and not has_function_privilege('service_role', 'public.remove_driver_settlement_difference(uuid, uuid, boolean)', 'execute'),
  'only the service role resolves a difference, and removal runs only inside the RPCs'
);

select throws_ok(
  format($$select public.post_driver_settlement_difference(%L, null, 'driver')$$, (select id from t_ds)),
  '55006', 'Solo se asienta la diferencia de una rendición confirmada.',
  'a draft resolves nothing'
);
select throws_ok(
  format($$select public.post_driver_settlement_difference(%L, null, 'ambos')$$, (select id from t_ds)),
  '22023', 'La diferencia queda a cargo del chofer o del cliente.',
  'only the driver or the client bears it'
);

create temp table t_receipts on commit drop as
select unnest(public.confirm_driver_settlement(
  (select id from t_ds), '00000000-0000-0000-0000-0000000046a1')) as id;

select is(pg_temp.open_d1(), 100::numeric,
  'after confirming, the invoice still owes the shortfall');

-- 1. A cargo del cliente --------------------------------------------------------

create temp table t_client on commit drop as
select public.post_driver_settlement_difference(
  (select id from t_ds), '00000000-0000-0000-0000-0000000046a1', 'client') as id;

select ok((select id is null from t_client), 'the client side writes no movement');
select is(
  (select difference_charged_to from public.driver_settlements where id = (select id from t_ds)),
  'client', 'the choice is recorded');
select is(pg_temp.open_d1(), 100::numeric, 'the invoice keeps its open balance');
select is(
  (select count(*)::int from public.employee_account_movements
    where employee_id = '00000000-0000-0000-0000-0000000046f9'),
  0, 'and the driver''s account is untouched');
select ok(
  public.post_driver_settlement_difference((select id from t_ds), null, 'client') is null,
  'resolving it the same way again is a no-op');
select throws_ok(
  format($$select public.post_driver_settlement_difference(%L, null, 'driver')$$, (select id from t_ds)),
  '55006', 'La diferencia ya quedó a cargo del cliente: quitala antes de cambiarla.',
  'the other side is refused until the first is removed'
);

-- Without hr:write the client side is still removable.
select lives_ok(
  format($$select public.unpost_driver_settlement_difference(%L, null, false)$$, (select id from t_ds)),
  'unposting a client-side difference needs no HR permission');
select ok(
  (select difference_charged_to is null from public.driver_settlements where id = (select id from t_ds)),
  'and leaves it unresolved');

-- 2. A cargo del chofer ---------------------------------------------------------

create temp table t_mov on commit drop as
select public.post_driver_settlement_difference(
  (select id from t_ds), '00000000-0000-0000-0000-0000000046a1', 'driver') as id;

select results_eq(
  $$select employee_id, kind, amount, currency, creditor, transaction_id is not null
      from public.employee_account_movements where id = (select id from t_mov)$$,
  $$values ('00000000-0000-0000-0000-0000000046f9'::uuid, 'advance'::text, 100::numeric,
            'ARS'::text, 'empresa'::text, true)$$,
  'a shortfall is an advance to the driver''s employee, with its treasury movement'
);
select is(
  (select balance from public.v_employee_account_balances
    where employee_id = '00000000-0000-0000-0000-0000000046f9' and currency = 'ARS'),
  100::numeric, 'the employee owes the shortfall'
);
select is(pg_temp.open_d1(), 0::numeric,
  'and the client''s invoice is settled: the shortfall is owed once');
select results_eq(
  $$select r.client_id, r.total_amount, r.status, r.created_by
      from public.driver_settlement_difference_receipts d
      join public.receipts r on r.id = d.receipt_id
     where d.settlement_id = (select id from t_ds)$$,
  $$values ('00000000-0000-0000-0000-0000000046c1'::uuid, 100::numeric, 'issued'::text,
            '00000000-0000-0000-0000-0000000046a1'::uuid)$$,
  'through one receipt for the client, linked to the rendición'
);
select is(
  (select sum(case when t.kind = 'income' then t.amount else -t.amount end)
     from public.transactions t
    where t.account_id = '00000000-0000-0000-0000-0000000046b1'),
  1400::numeric, 'the cash account nets the shortfall to zero (in from the client, out to the driver)'
);

select is(
  public.post_driver_settlement_difference((select id from t_ds), null, 'driver'),
  (select id from t_mov), 'resolving it again returns the same movement'
);
select is(
  (select count(*)::int from public.driver_settlement_difference_receipts
    where settlement_id = (select id from t_ds)),
  1, 'and writes no second receipt'
);

select throws_ok(
  $$update public.receipts set status = 'canceled', canceled_at = now()
     where id = (select receipt_id from public.driver_settlement_difference_receipts
                  where settlement_id = (select id from t_ds))$$,
  '55006', null,
  'the receipt that settled the client is not cancelled from Recibos'
);
select throws_ok(
  $$update public.employee_account_movements set amount = 1
     where id = (select id from t_mov)$$,
  '55006', null,
  'the amount is not edited by hand'
);
select throws_ok(
  $$select public.delete_employee_account_movement((select id from t_mov))$$,
  '55006', 'La diferencia de una rendición se quita desde la rendición',
  'nor deleted from the employee account'
);

-- 3. Cancelling (F6: without hr:write it cannot drop the driver's movement) -----

update public.receipts set status = 'canceled', canceled_at = now()
 where id in (select id from t_receipts);

select throws_ok(
  format($$select public.cancel_driver_settlement(%L, null, false)$$, (select id from t_ds)),
  '55006', 'La diferencia de la rendición está en la cuenta corriente del chofer: quitarla requiere permiso de escritura en RRHH.',
  'cancel without hr:write keeps the driver''s movement'
);
select throws_ok(
  format($$select public.unpost_driver_settlement_difference(%L, null, false)$$, (select id from t_ds)),
  '55006', 'La diferencia de la rendición está en la cuenta corriente del chofer: quitarla requiere permiso de escritura en RRHH.',
  'and so does unpost'
);

create temp table t_mov_tx on commit drop as
select transaction_id as id from public.employee_account_movements where id = (select id from t_mov);

select lives_ok(
  format($$select public.cancel_driver_settlement(%L, null)$$, (select id from t_ds)),
  'the rendición is cancelled'
);
select is(
  (select count(*)::int from public.employee_account_movements
    where driver_settlement_id = (select id from t_ds))
  + (select count(*)::int from public.transactions where id = (select id from t_mov_tx)),
  0, 'its difference leaves the driver''s account with its treasury movement'
);
select is(
  (select count(*)::int from public.receipts
    where status = 'issued'
      and notes like 'Rendición N° % — faltante%'
      and client_id = '00000000-0000-0000-0000-0000000046c1'),
  0, 'the receipt that settled the client is cancelled'
);
select is(pg_temp.open_d1(), 1000::numeric, 'and the invoice is open again');

-- 4. Overage and a driver without an employee -----------------------------------

create temp table t_ds2 on commit drop as
select public.save_driver_settlement(
  '00000000-0000-0000-0000-0000000046e1', '2026-11-04', null,
  pg_temp.items('00000000-0000-0000-0000-0000000046d1', array[1050]),
  null) as id;
select public.confirm_driver_settlement((select id from t_ds2), null);
select throws_ok(
  format($$select public.post_driver_settlement_difference(%L, null, 'driver')$$, (select id from t_ds2)),
  '23514', null,
  'an overage is not credited to the driver: it is on account in the client''s receipt'
);

create temp table t_ds3 on commit drop as
select public.save_driver_settlement(
  '00000000-0000-0000-0000-0000000046e2', '2026-11-04', null,
  pg_temp.items('00000000-0000-0000-0000-0000000046d3', array[250]),
  null) as id;
select public.confirm_driver_settlement((select id from t_ds3), null);
select throws_ok(
  format($$select public.post_driver_settlement_difference(%L, null, 'driver')$$, (select id from t_ds3)),
  '23514', 'El chofer Chofer Sin Legajo no está vinculado a un empleado: vinculalo en Flota › Choferes.',
  'a driver without an employee has no account to post to'
);

select * from finish();

rollback;
