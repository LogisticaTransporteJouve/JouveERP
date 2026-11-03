-- Roadmap 4.3: a liquidación groups a client's delivered cargas of a period
-- (priced at their flete or, without one, the client's freight tariff), is
-- confirmed with an R number, billed with one invoice and cancelled only once
-- that invoice is void. A carga is in one live liquidación at a time and is
-- not billed on its own meanwhile. One transaction, rolled back.

begin;

select plan(31);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000043a1', 'finance@liquidacion.test'),
  ('00000000-0000-0000-0000-0000000043a2', 'ops@liquidacion.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000043a1', 'finance'),
  ('00000000-0000-0000-0000-0000000043a2', 'operations');

-- An Otras ventas client (its invoice is a remito interno) and another one.
insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000043c1', false, null, 'Cliente Liquidación', null),
  ('00000000-0000-0000-0000-0000000043c2', false, null, 'Otro Cliente Liq', null);

insert into public.client_tariffs (client_id, concept, unit, price, valid_from) values
  ('00000000-0000-0000-0000-0000000043c1', 'freight', 'shipment', 2000, '2026-01-01');

insert into public.shipments
  (id, client_id, remito_number, origin, destination, status, delivery_date, scheduled_date, freight_amount)
values
  -- s1: own flete; s2: priced by the tariff; s3: another client's; s4: not
  -- delivered; s5: outside the period.
  ('00000000-0000-0000-0000-0000000043d1', '00000000-0000-0000-0000-0000000043c1', 'L-1', 'Rosario', 'Córdoba', 'delivered', '2026-10-05', null, 1000),
  ('00000000-0000-0000-0000-0000000043d2', '00000000-0000-0000-0000-0000000043c1', 'L-2', 'Rosario', 'Santa Fe', 'delivered', '2026-10-06', null, null),
  ('00000000-0000-0000-0000-0000000043d3', '00000000-0000-0000-0000-0000000043c2', 'L-3', null, null, 'delivered', '2026-10-07', null, 700),
  ('00000000-0000-0000-0000-0000000043d4', '00000000-0000-0000-0000-0000000043c1', 'L-4', null, null, 'not_started', null, '2026-10-08', 900),
  ('00000000-0000-0000-0000-0000000043d5', '00000000-0000-0000-0000-0000000043c1', 'L-5', null, null, 'delivered', '2026-11-05', null, 500);

-- 1. Grants -------------------------------------------------------------------

select ok(
  has_function_privilege('service_role', 'public.save_freight_settlement(uuid, date, date, uuid[], text, uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.save_freight_settlement(uuid, date, date, uuid[], text, uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.confirm_freight_settlement(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.link_freight_settlement_invoice(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.cancel_freight_settlement(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.freight_settlement_candidates(uuid, date, date, uuid)', 'execute'),
  'only the service role runs the liquidación RPCs'
);

select ok(
  not has_function_privilege('authenticated', 'public.freight_price(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_freight_settlement()', 'execute'),
  'nobody calls the pricing helper or the guards directly'
);

-- 2. Candidates and pricing ---------------------------------------------------

create temp table t_candidates on commit drop as
select * from public.freight_settlement_candidates(
  '00000000-0000-0000-0000-0000000043c1', '2026-10-01', '2026-10-31', null);

select results_eq(
  $$select shipment_id, amount, price_source from t_candidates order by service_date$$,
  $$values ('00000000-0000-0000-0000-0000000043d1'::uuid, 1000::numeric, 'freight'::text),
           ('00000000-0000-0000-0000-0000000043d2'::uuid, 2000::numeric, 'tariff'::text)$$,
  'candidates are the client''s delivered cargas of the period, at flete or tariff'
);

select throws_ok(
  $$insert into public.client_tariffs (client_id, concept, unit, price, currency, valid_from)
    values ('00000000-0000-0000-0000-0000000043c2', 'freight', 'shipment', 10, 'USD', '2026-01-01')$$,
  '23514', null,
  'a freight tariff is in pesos only'
);

-- 3. Drafts -------------------------------------------------------------------

create temp table t_s1 on commit drop as
select public.save_freight_settlement(
  '00000000-0000-0000-0000-0000000043c1', '2026-10-01', '2026-10-31',
  array['00000000-0000-0000-0000-0000000043d1', '00000000-0000-0000-0000-0000000043d2']::uuid[],
  'octubre', '00000000-0000-0000-0000-0000000043a1') as id;

select is(
  (select total from public.freight_settlements where id = (select id from t_s1)),
  3000.00::numeric(14, 2), 'the draft totals its cargas'
);

select is(
  (select count(*)::int from t_candidates c
    where not exists (select 1 from public.freight_settlement_candidates(
      '00000000-0000-0000-0000-0000000043c1', '2026-10-01', '2026-10-31', null) x
      where x.shipment_id = c.shipment_id)),
  2, 'a carga in a live liquidación is no longer a candidate'
);

select throws_ok(
  $$select public.save_freight_settlement(
      '00000000-0000-0000-0000-0000000043c1', '2026-10-01', '2026-10-31',
      array['00000000-0000-0000-0000-0000000043d1']::uuid[], '', null)$$,
  '23505', 'La carga L-1 ya está en otra liquidación en borrador.',
  'a carga is in one live liquidación only'
);

select throws_ok(
  $$select public.save_freight_settlement(
      '00000000-0000-0000-0000-0000000043c1', '2026-10-01', '2026-10-31',
      array['00000000-0000-0000-0000-0000000043d5']::uuid[], '', null)$$,
  '23514', 'La carga L-5 está fuera del período.',
  'a carga delivered outside the period is refused'
);

select throws_ok(
  $$select public.save_freight_settlement(
      '00000000-0000-0000-0000-0000000043c1', '2026-10-01', '2026-10-31',
      array['00000000-0000-0000-0000-0000000043d4']::uuid[], '', null)$$,
  '23514', 'La carga L-4 no está entregada: solo se liquidan cargas entregadas.',
  'an undelivered carga is refused'
);

select throws_ok(
  $$select public.save_freight_settlement(
      '00000000-0000-0000-0000-0000000043c1', '2026-10-01', '2026-10-31',
      array['00000000-0000-0000-0000-0000000043d3']::uuid[], '', null)$$,
  '23514', 'La carga L-3 es de otro cliente.',
  'another client''s carga is refused'
);

-- s5 loses its flete and the tariff ends before its day.
update public.shipments set freight_amount = null
 where id = '00000000-0000-0000-0000-0000000043d5';
update public.client_tariffs set valid_to = '2026-10-31'
 where client_id = '00000000-0000-0000-0000-0000000043c1';

select throws_ok(
  $$select public.save_freight_settlement(
      '00000000-0000-0000-0000-0000000043c1', '2026-11-01', '2026-11-30',
      array['00000000-0000-0000-0000-0000000043d5']::uuid[], '', null)$$,
  '23514', 'La carga L-5 no tiene flete ni tarifa de flete vigente: cargá uno de los dos.',
  'a carga with neither flete nor tariff is refused'
);

select throws_ok(
  $$update public.shipments set invoicing_claimed_at = now()
     where id = '00000000-0000-0000-0000-0000000043d1'$$,
  '55006', 'La carga está en una liquidación en borrador: se factura desde la liquidación.',
  'a carga in a liquidación is not invoiced alone'
);

select throws_ok(
  $$delete from public.shipments where id = '00000000-0000-0000-0000-0000000043d2'$$,
  '55006', null,
  'a carga in a liquidación is not deleted'
);

-- 4. Confirming ----------------------------------------------------------------

-- The tariff now ends on 31/10: s2 (6/10) keeps its price.
create temp table t_numero on commit drop as
select public.confirm_freight_settlement(
  (select id from t_s1), '00000000-0000-0000-0000-0000000043a1') as numero;

select is(
  (select status from public.freight_settlements where id = (select id from t_s1)),
  'confirmed', 'confirming moves the draft to confirmed'
);
select is(
  (select numero from public.freight_settlements where id = (select id from t_s1)),
  (select numero from t_numero), 'it takes its R number'
);
select is(
  public.confirm_freight_settlement((select id from t_s1), null),
  (select numero from t_numero), 'confirming again returns the same number'
);

select throws_ok(
  $$update public.shipments set freight_amount = 1200
     where id = '00000000-0000-0000-0000-0000000043d1'$$,
  '55006', null,
  'a confirmed liquidación freezes its cargas'' flete'
);
select throws_ok(
  format($$delete from public.freight_settlement_items where settlement_id = %L$$,
    (select id from t_s1)),
  '55006', 'La liquidación ya está confirmada: no se pueden sacar cargas.',
  'a confirmed liquidación keeps its cargas'
);
select throws_ok(
  format($$update public.freight_settlements set total = 1 where id = %L$$,
    (select id from t_s1)),
  '55006', null,
  'a confirmed liquidación keeps its total'
);

-- 5. Invoicing ----------------------------------------------------------------

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key)
values
  ('00000000-0000-0000-0000-0000000043f1', 'jouve_internal', '00000000-0000-0000-0000-0000000043c1',
   'factura', null, 9001, 99961, current_date, 2, 99, '0', 3000, 0, 3000, 'emitted', 'liq-test-1'),
  ('00000000-0000-0000-0000-0000000043f2', 'jouve_internal', '00000000-0000-0000-0000-0000000043c2',
   'factura', null, 9001, 99962, current_date, 2, 99, '0', 10, 0, 10, 'emitted', 'liq-test-2');

select throws_ok(
  format($$select public.link_freight_settlement_invoice(%L, '00000000-0000-0000-0000-0000000043f2')$$,
    (select id from t_s1)),
  '23514', 'La factura no es del cliente de la liquidación.',
  'another client''s invoice is not linked'
);

select public.link_freight_settlement_invoice(
  (select id from t_s1), '00000000-0000-0000-0000-0000000043f1');

select is(
  (select status from public.freight_settlements where id = (select id from t_s1)),
  'invoiced', 'linking the invoice makes it invoiced'
);
select results_eq(
  $$select id, invoice_id, freight_amount from public.shipments
     where id in ('00000000-0000-0000-0000-0000000043d1', '00000000-0000-0000-0000-0000000043d2')
     order by id$$,
  $$values ('00000000-0000-0000-0000-0000000043d1'::uuid, '00000000-0000-0000-0000-0000000043f1'::uuid, 1000::numeric),
           ('00000000-0000-0000-0000-0000000043d2'::uuid, '00000000-0000-0000-0000-0000000043f1'::uuid, 2000::numeric)$$,
  'its cargas point at the invoice, with the billed flete'
);

select throws_ok(
  format($$select public.cancel_freight_settlement(%L, null)$$, (select id from t_s1)),
  '55006', 'La liquidación está facturada: anulá la factura (o emití la nota de crédito por el total) antes de cancelarla.',
  'an invoiced liquidación is not cancelled while its invoice lives'
);

-- Cancelling the remito interno puts the liquidación back to confirmed.
update public.invoices set status = 'cancelled'
 where id = '00000000-0000-0000-0000-0000000043f1';

select results_eq(
  format($$select status, invoice_id from public.freight_settlements where id = %L$$, (select id from t_s1)),
  $$values ('confirmed'::text, null::uuid)$$,
  'a cancelled invoice releases its liquidación'
);
select is(
  (select count(*)::int from public.shipments
    where invoice_id = '00000000-0000-0000-0000-0000000043f1'),
  0, 'and its cargas'
);

-- 6. Cancelling ---------------------------------------------------------------

select lives_ok(
  format($$select public.cancel_freight_settlement(%L, '00000000-0000-0000-0000-0000000043a1')$$,
    (select id from t_s1)),
  'a confirmed liquidación without invoice is cancelled'
);
select is(
  (select count(*)::int from public.freight_settlement_items
    where settlement_id = (select id from t_s1) and not released),
  0, 'cancelling releases its cargas'
);
select lives_ok(
  $$select public.save_freight_settlement(
      '00000000-0000-0000-0000-0000000043c1', '2026-10-01', '2026-10-31',
      array['00000000-0000-0000-0000-0000000043d1']::uuid[], '', null)$$,
  'a released carga goes into a new liquidación'
);
select throws_ok(
  format($$update public.freight_settlements set notes = 'x' where id = %L$$, (select id from t_s1)),
  '55006', 'La liquidación está cancelada.',
  'a cancelled liquidación does not change'
);

-- 7. RLS ----------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000043a2","role":"authenticated"}', true);

select is_empty(
  $$select 1 from public.freight_settlements$$,
  'operations sees no liquidación'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000043a1","role":"authenticated"}', true);

select isnt_empty(
  $$select 1 from public.freight_settlements$$,
  'finance reads liquidaciones'
);

reset role;

select * from finish();

rollback;
