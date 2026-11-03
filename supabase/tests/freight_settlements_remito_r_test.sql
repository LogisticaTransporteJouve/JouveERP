-- The liquidación follows its client's side: a fiscal one is confirmed as a
-- Remito R (R9002-<8 digits>, its own correlativo), an internal one gets no
-- number (its document is the remito interno X the app issues), and one
-- confirmed the old way keeps its R-00000012. One transaction, rolled back.

begin;

select plan(20);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000044a1', 'finance@remito-r.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000044a1', 'finance');

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000044c1', true, '30744444447', 'Cliente Remito R', 'responsable_inscripto'),
  ('00000000-0000-0000-0000-0000000044c2', false, null, 'Cliente Remito X', null);

insert into public.shipments
  (id, client_id, remito_number, status, delivery_date, freight_amount)
values
  -- f1..f3: fiscal client; i1: internal client; l1: the legacy path.
  ('00000000-0000-0000-0000-0000000044d1', '00000000-0000-0000-0000-0000000044c1', 'F-1', 'delivered', '2026-10-05', 1000),
  ('00000000-0000-0000-0000-0000000044d2', '00000000-0000-0000-0000-0000000044c1', 'F-2', 'delivered', '2026-10-06', 1500),
  ('00000000-0000-0000-0000-0000000044d3', '00000000-0000-0000-0000-0000000044c1', 'F-3', 'delivered', '2026-10-07', 700),
  ('00000000-0000-0000-0000-0000000044d4', '00000000-0000-0000-0000-0000000044c2', 'I-1', 'delivered', '2026-10-05', 800),
  ('00000000-0000-0000-0000-0000000044d5', '00000000-0000-0000-0000-0000000044c1', 'L-1', 'delivered', '2026-10-08', 600);

create temp table t_ids on commit drop as
select
  public.save_freight_settlement('00000000-0000-0000-0000-0000000044c1', '2026-10-01', '2026-10-31',
    array['00000000-0000-0000-0000-0000000044d1']::uuid[], '', null) as fiscal_a,
  public.save_freight_settlement('00000000-0000-0000-0000-0000000044c1', '2026-10-01', '2026-10-31',
    array['00000000-0000-0000-0000-0000000044d2']::uuid[], '', null) as fiscal_b,
  public.save_freight_settlement('00000000-0000-0000-0000-0000000044c2', '2026-10-01', '2026-10-31',
    array['00000000-0000-0000-0000-0000000044d4']::uuid[], '', null) as internal,
  public.save_freight_settlement('00000000-0000-0000-0000-0000000044c1', '2026-10-01', '2026-10-31',
    array['00000000-0000-0000-0000-0000000044d5']::uuid[], '', null) as legacy;

create temp table t_base on commit drop as
select coalesce(max(remito_number), 0) as n
  from public.freight_settlements
 where remito_pos = public.freight_remito_pos();

-- 1. Grants -------------------------------------------------------------------

select ok(
  has_function_privilege('service_role', 'public.confirm_freight_settlement_document(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.confirm_freight_settlement_document(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.confirm_freight_settlement_document(uuid, uuid)', 'execute'),
  'only the service role confirms a liquidación'
);
select ok(
  not has_function_privilege('authenticated', 'public.reprice_freight_settlement(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.freight_remito_pos()', 'execute')
  and not has_function_privilege('anon', 'public.freight_settlement_label(bigint, integer, bigint)', 'execute')
  -- The label is pure formatting used by shipment guards that run as the user.
  and has_function_privilege('authenticated', 'public.freight_settlement_label(bigint, integer, bigint)', 'execute'),
  'the helpers stay internal; only the pure label is callable by users'
);

-- 2. Old liquidaciones keep their number ---------------------------------------

-- Confirmed the old way (the RPC code before this change still calls).
create temp table t_legacy on commit drop as
select public.confirm_freight_settlement((select legacy from t_ids), null) as numero;

select results_eq(
  format($$select numero, channel, remito_pos, remito_number from public.freight_settlements where id = %L$$,
    (select legacy from t_ids)),
  format($$values (%s::bigint, null::text, null::integer, null::bigint)$$, (select numero from t_legacy)),
  'the legacy confirm still numbers R-…, with no channel and no remito'
);
select results_eq(
  format($$select channel, numero, remito_pos, remito_number
             from public.confirm_freight_settlement_document(%L, null)$$, (select legacy from t_ids)),
  format($$values (null::text, %s::bigint, null::integer, null::bigint)$$, (select numero from t_legacy)),
  'confirming a legacy liquidación again returns its R- number and gives it no remito'
);

-- 3. Fiscal: Remito R ------------------------------------------------------------

create temp table t_fa on commit drop as
select * from public.confirm_freight_settlement_document(
  (select fiscal_a from t_ids), '00000000-0000-0000-0000-0000000044a1');

select results_eq(
  $$select channel, numero, remito_pos, remito_number from t_fa$$,
  $$select 'fiscal'::text, null::bigint, 9002, (select n + 1 from t_base)$$,
  'a fiscal liquidación takes the next Remito R number on point of sale 9002'
);
select matches(
  (select public.freight_settlement_label(null, remito_pos, remito_number) from t_fa),
  '^el remito R9002-[0-9]{8}$',
  'its number prints as R<pos 4>-<8 digits>'
);
select results_eq(
  format($$select status, channel, numero from public.freight_settlements where id = %L$$,
    (select fiscal_a from t_ids)),
  $$values ('confirmed'::text, 'fiscal'::text, null::bigint)$$,
  'it is confirmed on the fiscal side, without a legacy number'
);
select results_eq(
  format($$select channel, numero, remito_pos, remito_number
             from public.confirm_freight_settlement_document(%L, null)$$, (select fiscal_a from t_ids)),
  $$select channel, numero, remito_pos, remito_number from t_fa$$,
  'confirming again returns the same remito'
);

create temp table t_fb on commit drop as
select * from public.confirm_freight_settlement_document((select fiscal_b from t_ids), null);

select is(
  (select remito_number from t_fb),
  (select remito_number + 1 from t_fa),
  'the next fiscal liquidación takes the next number'
);

-- 4. Internal: no R ---------------------------------------------------------------

create temp table t_int on commit drop as
select * from public.confirm_freight_settlement_document((select internal from t_ids), null);

select results_eq(
  $$select channel, numero, remito_pos, remito_number from t_int$$,
  $$values ('internal'::text, null::bigint, null::integer, null::bigint)$$,
  'an internal liquidación gets no R number'
);
select results_eq(
  format($$select status, channel, numero, remito_number from public.freight_settlements where id = %L$$,
    (select internal from t_ids)),
  $$values ('confirmed'::text, 'internal'::text, null::bigint, null::bigint)$$,
  'it is confirmed, waiting for its remito interno X'
);
select is(
  (select remito_number from public.confirm_freight_settlement_document((select fiscal_b from t_ids), null)),
  (select remito_number from t_fb),
  'confirming an internal one did not use a remito number'
);

-- 5. Guards (as the table owner) ---------------------------------------------------

reset role;

select throws_ok(
  format($$update public.freight_settlements set remito_number = remito_number + 100 where id = %L$$,
    (select fiscal_a from t_ids)),
  '55006', 'La liquidación ya está confirmada: no se pueden cambiar su período, sus cargas, su total ni su número.',
  'a confirmed liquidación keeps its remito number'
);
select throws_ok(
  format($$update public.freight_settlements set channel = 'internal' where id = %L$$,
    (select fiscal_a from t_ids)),
  '55006', null,
  'a confirmed liquidación keeps its side'
);
select throws_ok(
  format($$insert into public.freight_settlements
             (client_id, period_start, period_end, channel, remito_pos, remito_number)
           values ('00000000-0000-0000-0000-0000000044c1', '2026-10-01', '2026-10-31', 'fiscal', %s, %s)$$,
    (select remito_pos from t_fa), (select remito_number from t_fa)),
  '23505', null,
  'a remito number is used once per point of sale'
);
select throws_ok(
  $$insert into public.freight_settlements
      (client_id, period_start, period_end, channel, remito_pos, remito_number)
    values ('00000000-0000-0000-0000-0000000044c2', '2026-10-01', '2026-10-31', 'internal', 9002, 999999)$$,
  '23514', null,
  'only the fiscal side has a remito R'
);
select throws_ok(
  $$insert into public.freight_settlements (client_id, period_start, period_end, status)
    values ('00000000-0000-0000-0000-0000000044c1', '2026-10-01', '2026-10-31', 'confirmed')$$,
  '23514', null,
  'a confirmed liquidación has a document: a remito R, the legacy R- or the internal side'
);
select throws_ok(
  $$select public.save_freight_settlement(
      '00000000-0000-0000-0000-0000000044c1', '2026-10-01', '2026-10-31',
      array['00000000-0000-0000-0000-0000000044d1']::uuid[], '', null)$$,
  '23505',
  (select 'La carga F-1 ya está en el remito R9002-' || lpad(remito_number::text, 8, '0') || '.' from t_fa),
  'a carga is in one live liquidación, named by its remito R'
);
select throws_ok(
  $$update public.shipments set freight_amount = 1
     where id = '00000000-0000-0000-0000-0000000044d4'$$,
  '55006', 'La carga está en una liquidación de Otras ventas, ya confirmada: su flete no cambia.',
  'an internal confirmed liquidación freezes its cargas'' flete'
);

-- 6. RLS ----------------------------------------------------------------------------

grant select on t_ids to authenticated;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000044a1","role":"authenticated"}', true);

select results_eq(
  $$select channel from public.freight_settlements
     where id in (select fiscal_a from t_ids union all select internal from t_ids)
     order by channel$$,
  $$values ('fiscal'::text), ('internal'::text)$$,
  'finance reads the side of each liquidación'
);

reset role;

select * from finish();

rollback;
