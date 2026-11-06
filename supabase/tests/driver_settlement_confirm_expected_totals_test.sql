-- confirm_driver_settlement(uuid, uuid, numeric, numeric): the confirm an
-- assistant proposal runs, refused (and rolled back) when what the driver
-- had to collect or what he handed in is not what the proposal showed. One
-- transaction, rolled back.

begin;

select plan(7);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000047c1', false, null, 'Cliente Rendición Esperada', null);
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000000047b1', 'Caja Rendición Esperada', 'cash', 'ARS');
insert into public.drivers (id, full_name) values
  ('00000000-0000-0000-0000-0000000047e1', 'Chofer Esperado');
insert into public.trips (id, trip_date, driver_id) values
  ('00000000-0000-0000-0000-0000000047f1', '2026-11-01', '00000000-0000-0000-0000-0000000047e1');
insert into public.shipments
  (id, client_id, trip_id, remito_number, status, delivery_date, cod_amount)
values
  ('00000000-0000-0000-0000-0000000047d1', '00000000-0000-0000-0000-0000000047c1',
   '00000000-0000-0000-0000-0000000047f1', 'X-1', 'delivered', '2026-11-01', 1000);

create function pg_temp.items(p_amount numeric)
returns jsonb language sql as $f$
  select jsonb_build_array(jsonb_build_object(
    'shipment_id', '00000000-0000-0000-0000-0000000047d1',
    'lines', jsonb_build_array(jsonb_build_object(
      'account_id', '00000000-0000-0000-0000-0000000047b1', 'amount', p_amount))))
$f$;

create temp table t_ds on commit drop as
select public.save_driver_settlement(
  '00000000-0000-0000-0000-0000000047e1', '2026-11-03', '', pg_temp.items(1000), null) as id;

select ok(
  has_function_privilege('service_role', 'public.confirm_driver_settlement(uuid, uuid, numeric, numeric)', 'execute')
  and not has_function_privilege('authenticated', 'public.confirm_driver_settlement(uuid, uuid, numeric, numeric)', 'execute')
  and not has_function_privilege('anon', 'public.confirm_driver_settlement(uuid, uuid, numeric, numeric)', 'execute'),
  'only the service role confirms with expected totals'
);

-- The draft is re-saved with 900 after the proposal showed 1000.
select public.save_driver_settlement(
  '00000000-0000-0000-0000-0000000047e1', '2026-11-03', '', pg_temp.items(900),
  null, (select id from t_ds));

select throws_ok(
  format($$select public.confirm_driver_settlement(%L, null, 1000, 1000)$$, (select id from t_ds)),
  '22023',
  'La rendición cambió desde la propuesta (se editó un pago o el importe contra entrega de una carga): revisala y volvé a confirmarla.',
  'what was handed in changed since the proposal: refused'
);
select results_eq(
  format($$select ds.status, ds.numero,
                  (select count(*)::int from public.receipts r
                    where r.client_id = '00000000-0000-0000-0000-0000000047c1')
             from public.driver_settlements ds where ds.id = %L$$, (select id from t_ds)),
  $$values ('draft'::text, null::bigint, 0)$$,
  'the refusal rolls back the receipts and the number'
);
select throws_ok(
  format($$select public.confirm_driver_settlement(%L, null, 1100, 900)$$, (select id from t_ds)),
  '22023', null,
  'an expected total that is not the cargas'' is refused'
);

select is(
  cardinality(public.confirm_driver_settlement((select id from t_ds), null, 1000, 900)),
  1,
  'the totals the server shows now confirm and post the receipt'
);
select lives_ok(
  format($$select public.confirm_driver_settlement(%L, null, 1, 1)$$, (select id from t_ds)),
  'confirming a confirmed rendición again returns its receipts, as the two-argument confirm'
);
select is(
  (select status from public.driver_settlements where id = (select id from t_ds)),
  'confirmed', 'it is confirmed'
);

select * from finish();
rollback;
