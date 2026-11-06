-- confirm_freight_settlement_document(uuid, uuid, numeric): the confirm an
-- assistant proposal runs, refused (and rolled back) when the repriced total
-- is not the one the proposal showed. One transaction, rolled back.

begin;

select plan(7);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000046c1', true, '30746666660', 'Cliente Total Esperado', 'responsable_inscripto');

insert into public.shipments
  (id, client_id, remito_number, status, delivery_date, freight_amount)
values
  ('00000000-0000-0000-0000-0000000046d1', '00000000-0000-0000-0000-0000000046c1', 'E-1', 'delivered', '2026-10-05', 1000),
  ('00000000-0000-0000-0000-0000000046d2', '00000000-0000-0000-0000-0000000046c1', 'E-2', 'delivered', '2026-10-06', 1500);

create temp table t_ids on commit drop as
select
  public.save_freight_settlement('00000000-0000-0000-0000-0000000046c1', '2026-10-01', '2026-10-31',
    array['00000000-0000-0000-0000-0000000046d1']::uuid[], '', null) as a,
  public.save_freight_settlement('00000000-0000-0000-0000-0000000046c1', '2026-10-01', '2026-10-31',
    array['00000000-0000-0000-0000-0000000046d2']::uuid[], '', null) as b;

select ok(
  has_function_privilege('service_role', 'public.confirm_freight_settlement_document(uuid, uuid, numeric)', 'execute')
  and not has_function_privilege('authenticated', 'public.confirm_freight_settlement_document(uuid, uuid, numeric)', 'execute')
  and not has_function_privilege('anon', 'public.confirm_freight_settlement_document(uuid, uuid, numeric)', 'execute'),
  'only the service role confirms with an expected total'
);

-- The flete of the first carga changes after the proposal showed 1000.
update public.shipments set freight_amount = 1200
 where id = '00000000-0000-0000-0000-0000000046d1';

select throws_ok(
  format($$select * from public.confirm_freight_settlement_document(%L, null, 1000)$$,
    (select a from t_ids)),
  '22023',
  'El total de la liquidación cambió desde la propuesta (se editó el flete o la tarifa de una carga): revisala y volvé a confirmarla.',
  'a total that changed since the proposal is refused'
);
select results_eq(
  format($$select status, remito_number, total from public.freight_settlements where id = %L$$,
    (select a from t_ids)),
  $$values ('draft'::text, null::bigint, 1000::numeric)$$,
  'the refusal rolls back the repricing and takes no remito number'
);

select results_eq(
  format($$select channel from public.confirm_freight_settlement_document(%L, null, 1200)$$,
    (select a from t_ids)),
  $$values ('fiscal'::text)$$,
  'the total the server shows now confirms'
);
select results_eq(
  format($$select status, total from public.freight_settlements where id = %L$$,
    (select a from t_ids)),
  $$values ('confirmed'::text, 1200::numeric)$$,
  'it is confirmed at that total'
);
select lives_ok(
  format($$select * from public.confirm_freight_settlement_document(%L, null, 1)$$,
    (select a from t_ids)),
  'confirming a confirmed liquidación again returns it, as the two-argument confirm'
);

-- The two-argument confirm is untouched.
select results_eq(
  format($$select channel from public.confirm_freight_settlement_document(%L, null)$$,
    (select b from t_ids)),
  $$values ('fiscal'::text)$$,
  'the form''s confirm still confirms without an expected total'
);

select * from finish();
rollback;
