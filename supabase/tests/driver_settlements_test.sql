-- Roadmap 4.5: a rendición records what a driver handed in for the
-- cash-on-delivery cargas they delivered; confirming it posts receipts (one
-- per client and channel) through create_receipt, applied to each carga's
-- invoice, once. A carga is in one live rendición; a confirmed rendición is
-- frozen and cancelled only after its receipts. One transaction, rolled back.

begin;

select plan(25);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000045a1', 'finance@rendicion.test'),
  ('00000000-0000-0000-0000-0000000045a2', 'ops@rendicion.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000045a1', 'finance'),
  ('00000000-0000-0000-0000-0000000045a2', 'operations');

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000045c1', false, null, 'Cliente Contra Entrega', null);

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000000045b1', 'Caja Rendición Test', 'cash', 'ARS'),
  ('00000000-0000-0000-0000-0000000045b2', 'Cartera Rendición Test', 'checks', 'ARS'),
  ('00000000-0000-0000-0000-0000000045b3', 'Caja USD Rendición Test', 'cash', 'USD');

insert into public.drivers (id, full_name) values
  ('00000000-0000-0000-0000-0000000045e1', 'Chofer Uno'),
  ('00000000-0000-0000-0000-0000000045e2', 'Chofer Dos');
insert into public.trips (id, trip_date, driver_id) values
  ('00000000-0000-0000-0000-0000000045f1', '2026-11-01', '00000000-0000-0000-0000-0000000045e1'),
  ('00000000-0000-0000-0000-0000000045f2', '2026-11-01', '00000000-0000-0000-0000-0000000045e2');

-- The remito interno that bills c2.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key)
values
  ('00000000-0000-0000-0000-0000000045a9', 'jouve_internal', '00000000-0000-0000-0000-0000000045c1',
   'factura', null, 9001, 99971, current_date, 2, 99, '0', 500, 0, 500, 'emitted', 'rend-test-1');

insert into public.shipments
  (id, client_id, trip_id, remito_number, status, delivery_date, cod_amount, invoice_id)
values
  -- c1, c2: driver one; c3: driver two; c4: not cash-on-delivery; c5: not
  -- delivered.
  ('00000000-0000-0000-0000-0000000045d1', '00000000-0000-0000-0000-0000000045c1', '00000000-0000-0000-0000-0000000045f1', 'C-1', 'delivered', '2026-11-01', 1000, null),
  ('00000000-0000-0000-0000-0000000045d2', '00000000-0000-0000-0000-0000000045c1', '00000000-0000-0000-0000-0000000045f1', 'C-2', 'delivered', '2026-11-01', 500, '00000000-0000-0000-0000-0000000045a9'),
  ('00000000-0000-0000-0000-0000000045d3', '00000000-0000-0000-0000-0000000045c1', '00000000-0000-0000-0000-0000000045f2', 'C-3', 'delivered', '2026-11-01', 300, null),
  ('00000000-0000-0000-0000-0000000045d4', '00000000-0000-0000-0000-0000000045c1', '00000000-0000-0000-0000-0000000045f1', 'C-4', 'delivered', '2026-11-01', null, null),
  ('00000000-0000-0000-0000-0000000045d5', '00000000-0000-0000-0000-0000000045c1', '00000000-0000-0000-0000-0000000045f1', 'C-5', 'in_progress', null, 200, null);

-- 1. Grants and the carga's amount -----------------------------------------------

select ok(
  has_function_privilege('service_role', 'public.confirm_driver_settlement(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.confirm_driver_settlement(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.save_driver_settlement(uuid, date, text, jsonb, uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.cancel_driver_settlement(uuid, uuid)', 'execute'),
  'only the service role runs the rendición RPCs'
);

select throws_ok(
  $$update public.shipments set cod_amount = 0
     where id = '00000000-0000-0000-0000-0000000045d4'$$,
  '23514', null,
  'a cash-on-delivery amount is positive'
);

-- 2. What a rendición takes --------------------------------------------------------

create function pg_temp.items(p_shipment text, p_account text, p_amount numeric, p_check jsonb default '{}')
returns jsonb language sql as $f$
  select jsonb_build_array(jsonb_build_object(
    'shipment_id', p_shipment,
    'lines', jsonb_build_array(
      jsonb_build_object('account_id', p_account, 'amount', p_amount) || p_check)))
$f$;

select throws_ok(
  $$select public.save_driver_settlement('00000000-0000-0000-0000-0000000045e1', '2026-11-03', '',
      pg_temp.items('00000000-0000-0000-0000-0000000045d3', '00000000-0000-0000-0000-0000000045b1', 300), null)$$,
  '23514', 'La carga C-3 no viajó con este chofer.',
  'another driver''s carga is refused'
);
select throws_ok(
  $$select public.save_driver_settlement('00000000-0000-0000-0000-0000000045e1', '2026-11-03', '',
      pg_temp.items('00000000-0000-0000-0000-0000000045d4', '00000000-0000-0000-0000-0000000045b1', 1), null)$$,
  '23514', 'La carga C-4 no es contra entrega.',
  'a carga that is not cash-on-delivery is refused'
);
select throws_ok(
  $$select public.save_driver_settlement('00000000-0000-0000-0000-0000000045e1', '2026-11-03', '',
      pg_temp.items('00000000-0000-0000-0000-0000000045d5', '00000000-0000-0000-0000-0000000045b1', 200), null)$$,
  '23514', 'La carga C-5 no está entregada: se rinde lo cobrado al entregar.',
  'an undelivered carga is refused'
);
select throws_ok(
  $$select public.save_driver_settlement('00000000-0000-0000-0000-0000000045e1', '2026-11-03', '',
      pg_temp.items('00000000-0000-0000-0000-0000000045d1', '00000000-0000-0000-0000-0000000045b3', 1000), null)$$,
  '23514', 'La rendición se asienta en pesos: elegí una cuenta en ARS.',
  'a USD account is refused'
);
select throws_ok(
  $$select public.save_driver_settlement('00000000-0000-0000-0000-0000000045e1', '2026-11-03', '',
      pg_temp.items('00000000-0000-0000-0000-0000000045d1', '00000000-0000-0000-0000-0000000045b2', 1000), null)$$,
  '23514', 'Un cheque necesita número, banco y fecha de pago.',
  'a check line needs its check'
);

-- c1 in cash, c2 by a check of 450 (50 short).
create temp table t_ds on commit drop as
select public.save_driver_settlement(
  '00000000-0000-0000-0000-0000000045e1', '2026-11-03', 'semana 44',
  pg_temp.items('00000000-0000-0000-0000-0000000045d1', '00000000-0000-0000-0000-0000000045b1', 1000)
  || pg_temp.items('00000000-0000-0000-0000-0000000045d2', '00000000-0000-0000-0000-0000000045b2', 450,
       '{"check_number":"778899","bank_name":"Banco Rendición","check_due_date":"2026-12-01"}'),
  '00000000-0000-0000-0000-0000000045a1') as id;

select results_eq(
  format($$select i.expected_amount, coalesce(sum(l.amount), 0)
             from public.driver_settlement_items i
             left join public.driver_settlement_lines l on l.item_id = i.id
            where i.settlement_id = %L
            group by i.id, i.expected_amount
            order by i.expected_amount$$, (select id from t_ds)),
  $$values (500::numeric, 450::numeric), (1000::numeric, 1000::numeric)$$,
  'the draft keeps what was expected and what came in, per carga'
);

select throws_ok(
  $$select public.save_driver_settlement('00000000-0000-0000-0000-0000000045e1', '2026-11-03', '',
      pg_temp.items('00000000-0000-0000-0000-0000000045d1', '00000000-0000-0000-0000-0000000045b1', 1000), null)$$,
  '23505', 'La carga C-1 ya está en otra rendición en borrador.',
  'a carga is in one live rendición only'
);

select throws_ok(
  $$update public.shipments set cod_amount = 900
     where id = '00000000-0000-0000-0000-0000000045d1'$$,
  '55006', null,
  'a carga in a rendición keeps its amount'
);
select throws_ok(
  $$update public.trips set driver_id = '00000000-0000-0000-0000-0000000045e2'
     where id = '00000000-0000-0000-0000-0000000045f1'$$,
  '55006', 'El viaje tiene cargas en una rendición: cancelala antes de cambiar el chofer.',
  'the trip of a carga in a rendición keeps its driver'
);

-- 3. Confirming posts the receipts once ---------------------------------------------

create temp table t_receipts on commit drop as
select unnest(public.confirm_driver_settlement(
  (select id from t_ds), '00000000-0000-0000-0000-0000000045a1')) as id;

select is((select count(*)::int from t_receipts), 1,
  'one client on one channel gets one receipt');
select results_eq(
  $$select r.channel_id, r.client_id, r.total_amount, r.currency, r.created_by
      from public.receipts r where r.id = (select id from t_receipts)$$,
  $$values ('jouve_internal'::text, '00000000-0000-0000-0000-0000000045c1'::uuid,
            1450::numeric, 'ARS'::text, '00000000-0000-0000-0000-0000000045a1'::uuid)$$,
  'the receipt is the client''s, for what was handed in, by the user who confirmed'
);
select is(
  (select count(*)::int from public.transactions where receipt_id = (select id from t_receipts)),
  2, 'each line is a treasury movement owned by the receipt'
);
select results_eq(
  $$select check_number, amount, status from public.checks
     where source_receipt_id = (select id from t_receipts)$$,
  $$values ('778899'::text, 450::numeric, 'en_cartera'::text)$$,
  'the check enters cartera'
);
select results_eq(
  $$select invoice_id, amount_applied from public.receipt_allocations
     where receipt_id = (select id from t_receipts)$$,
  $$values ('00000000-0000-0000-0000-0000000045a9'::uuid, 450::numeric)$$,
  'what was collected for an invoiced carga is applied to its invoice'
);
select is(
  (select status from public.driver_settlements where id = (select id from t_ds)),
  'confirmed', 'the rendición is confirmed'
);

select set_eq(
  format($$select unnest(public.confirm_driver_settlement(%L, null))$$, (select id from t_ds)),
  $$select id from t_receipts$$,
  'confirming again returns the same receipts'
);
select is(
  (select count(*)::int from public.receipts
    where client_id = '00000000-0000-0000-0000-0000000045c1'),
  1, 'and posts nothing twice'
);

select throws_ok(
  format($$update public.driver_settlement_lines set amount = 1
            where item_id in (select id from public.driver_settlement_items where settlement_id = %L)$$,
    (select id from t_ds)),
  '55006', 'La rendición ya está confirmada: lo entregado no cambia.',
  'a confirmed rendición is frozen'
);

-- 4. Cancelling --------------------------------------------------------------------

select throws_ok(
  format($$select public.cancel_driver_settlement(%L, null)$$, (select id from t_ds)),
  '55006', 'La rendición tiene recibos vigentes: anulalos antes de cancelarla.',
  'a rendición with a live receipt is not cancelled'
);

update public.receipts set status = 'canceled', canceled_at = now()
 where id = (select id from t_receipts);

select lives_ok(
  format($$select public.cancel_driver_settlement(%L, '00000000-0000-0000-0000-0000000045a1')$$,
    (select id from t_ds)),
  'once its receipts are cancelled the rendición is cancelled'
);
select is(
  (select count(*)::int from public.driver_settlement_items
    where settlement_id = (select id from t_ds) and not released),
  0, 'its cargas are pending again'
);

-- 5. RLS ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000045a2","role":"authenticated"}', true);

select is_empty(
  $$select 1 from public.driver_settlements$$,
  'operations sees no rendición'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000045a1","role":"authenticated"}', true);

select isnt_empty(
  $$select 1 from public.driver_settlement_lines$$,
  'finance reads what was handed in'
);

reset role;

select * from finish();

rollback;
