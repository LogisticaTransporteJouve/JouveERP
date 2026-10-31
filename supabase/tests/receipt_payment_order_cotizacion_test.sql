-- USD receipts and payment orders carry their exchange rate (20261031203102):
-- the RPCs require it (> 1) on USD and drop it on ARS, the asiento posts every
-- line in pesos at that rate with the counterparty as the sum of the rounded
-- lines, an edit that sends no rate keeps the stored one, and a rate change
-- re-posts. Deferred triggers run at `set constraints all immediate`. One
-- transaction, rolled back.

begin;

select plan(20);

create function pg_temp.live_role_amount(p_source text, p_id uuid, p_role text, p_side text)
returns numeric
language sql as $$
  select coalesce(sum(case when p_side = 'debit' then l.debit else l.credit end), 0)
    from public.journal_entries je
    join public.journal_entry_lines l on l.journal_entry_id = je.id
    join public.chart_of_accounts c on c.id = l.chart_of_accounts_id
   where je.source_table = p_source and je.source_id = p_id and not je.is_reversal
     and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = je.id)
     and c.system_role::text = p_role;
$$;

create function pg_temp.live_balance(p_source text, p_id uuid) returns numeric
language sql as $$
  select coalesce(sum(l.debit) - sum(l.credit), 0)
    from public.journal_entries je
    join public.journal_entry_lines l on l.journal_entry_id = je.id
   where je.source_table = p_source and je.source_id = p_id and not je.is_reversal
     and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = je.id);
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000df1', 'finance@cotizacion.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-000000000df1', 'finance');

insert into public.clients (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000cd01', '20777777772', 'Cliente Dólar', 'responsable_inscripto');
insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000bd01', '30777777773', 'Proveedor Dólar', 'responsable_inscripto');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000ad01', 'Banco USD Test', 'bank', 'USD'),
  ('00000000-0000-0000-0000-00000000ad02', 'Banco ARS Test', 'bank', 'ARS');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000df1","role":"authenticated"}', true);

-- Receipts -------------------------------------------------------------------

select throws_ok(
  $$select public.create_receipt('jouve_fiscal', 3, 9701, '00000000-0000-0000-0000-00000000cd01',
      current_date, 100, 'USD', null,
      '[{"account_id":"00000000-0000-0000-0000-00000000ad01","amount":100}]'::jsonb,
      '[]'::jsonb, '[]'::jsonb)$$,
  '23514',
  'Cargá la cotización del dólar (tiene que ser mayor a 1).',
  'a USD receipt without a rate is rejected'
);

select throws_ok(
  $$select public.create_receipt('jouve_fiscal', 3, 9701, '00000000-0000-0000-0000-00000000cd01',
      current_date, 100, 'USD', null,
      '[{"account_id":"00000000-0000-0000-0000-00000000ad01","amount":100}]'::jsonb,
      '[]'::jsonb, '[]'::jsonb, 1)$$,
  '23514',
  'Cargá la cotización del dólar (tiene que ser mayor a 1).',
  'a USD receipt at a rate of 1 is rejected'
);

select lives_ok(
  $$select public.create_receipt('jouve_fiscal', 3, 9702, '00000000-0000-0000-0000-00000000cd01',
      current_date, 110.33, 'USD', null,
      '[{"account_id":"00000000-0000-0000-0000-00000000ad01","amount":100.33}]'::jsonb,
      '[]'::jsonb,
      '[{"kind":"retencion","tax_type":"ganancias","certificate_number":"C-USD","certificate_date":"2026-10-31","amount":10}]'::jsonb,
      1000.5)$$,
  'a USD receipt with its rate is created'
);

select lives_ok(
  $$select public.create_receipt('jouve_fiscal', 3, 9703, '00000000-0000-0000-0000-00000000cd01',
      current_date, 50, 'ARS', null,
      '[{"account_id":"00000000-0000-0000-0000-00000000ad02","amount":50}]'::jsonb,
      '[]'::jsonb, '[]'::jsonb, 1200)$$,
  'an ARS receipt ignores a rate sent to it'
);

select is(
  (select cotizacion from public.receipts where punto_venta = 3 and numero = 9703 and channel_id = 'jouve_fiscal'),
  null::numeric,
  'the ARS receipt stores no rate'
);

select lives_ok('set constraints all immediate', 'the receipts post their entries');

create temp table t_ids on commit drop as
select
  (select id from public.receipts where channel_id = 'jouve_fiscal' and punto_venta = 3 and numero = 9702) as usd_receipt,
  (select id from public.receipts where channel_id = 'jouve_fiscal' and punto_venta = 3 and numero = 9703) as ars_receipt;

-- 100.33 × 1000.5 = 100380.165 → 100380.17; 10 × 1000.5 = 10005.00.
select is(
  pg_temp.live_role_amount('receipts', (select usd_receipt from t_ids), 'banco', 'debit'),
  100380.17::numeric,
  'the payment line is debited in pesos at the receipt rate'
);

select is(
  pg_temp.live_role_amount('receipts', (select usd_receipt from t_ids), 'retenciones_pagadas', 'debit'),
  10005.00::numeric,
  'the retention is debited in pesos at the receipt rate'
);

select is(
  pg_temp.live_role_amount('receipts', (select usd_receipt from t_ids), 'clientes', 'credit'),
  110385.17::numeric,
  'clientes is credited the sum of the rounded lines'
);

select is(
  pg_temp.live_balance('receipts', (select usd_receipt from t_ids)),
  0::numeric,
  'the USD receipt entry balances'
);

select lives_ok(
  $$select public.update_receipt((select usd_receipt from t_ids), current_date, 110.33, 'sin cotización',
      '[{"account_id":"00000000-0000-0000-0000-00000000ad01","amount":100.33}]'::jsonb,
      '[]'::jsonb,
      '[{"kind":"retencion","tax_type":"ganancias","certificate_number":"C-USD","certificate_date":"2026-10-31","amount":10}]'::jsonb)$$,
  'an edit that sends no rate is accepted'
);

select is(
  (select cotizacion from public.receipts where id = (select usd_receipt from t_ids)),
  1000.5::numeric,
  'an edit that sends no rate keeps the stored one'
);

select lives_ok(
  $$select public.update_receipt((select usd_receipt from t_ids), current_date, 110.33, null,
      '[{"account_id":"00000000-0000-0000-0000-00000000ad01","amount":100.33}]'::jsonb,
      '[]'::jsonb,
      '[{"kind":"retencion","tax_type":"ganancias","certificate_number":"C-USD","certificate_date":"2026-10-31","amount":10}]'::jsonb,
      1200)$$,
  'an edit can change the rate'
);

-- 100.33 × 1200 = 120396; 10 × 1200 = 12000.
select is(
  pg_temp.live_role_amount('receipts', (select usd_receipt from t_ids), 'clientes', 'credit'),
  132396.00::numeric,
  'a rate change re-posts the receipt at the new rate'
);

select throws_ok(
  $$update public.receipts set cotizacion = 1000 where id = (select ars_receipt from t_ids)$$,
  '23514',
  'Un documento en pesos no lleva cotización.',
  'an ARS receipt cannot take a rate'
);

-- Payment orders -------------------------------------------------------------

-- Back to deferred: the insert trigger posts once the lines exist.
set constraints all deferred;

select throws_ok(
  $$select public.create_payment_order('jouve_fiscal', 3, 9711, '00000000-0000-0000-0000-00000000bd01',
      current_date, 80, 'USD', null,
      '[{"line_kind":"account","account_id":"00000000-0000-0000-0000-00000000ad01","amount":80}]'::jsonb,
      '[]'::jsonb)$$,
  '23514',
  'Cargá la cotización del dólar (tiene que ser mayor a 1).',
  'a USD payment order without a rate is rejected'
);

select lives_ok(
  $$select public.create_payment_order('jouve_fiscal', 3, 9712, '00000000-0000-0000-0000-00000000bd01',
      current_date, 80.07, 'USD', null,
      '[{"line_kind":"account","account_id":"00000000-0000-0000-0000-00000000ad01","amount":80.07}]'::jsonb,
      '[]'::jsonb, 950.25)$$,
  'a USD payment order with its rate is created'
);

insert into t_ids (usd_receipt)
select id from public.payment_orders where channel_id = 'jouve_fiscal' and punto_venta = 3 and numero = 9712;

set constraints all immediate;

-- 80.07 × 950.25 = 76086.5175 → 76086.52.
select is(
  pg_temp.live_role_amount('payment_orders',
    (select usd_receipt from t_ids where ars_receipt is null), 'proveedores', 'debit'),
  76086.52::numeric,
  'proveedores is debited in pesos at the payment order rate'
);

select lives_ok(
  $$select public.update_payment_order((select usd_receipt from t_ids where ars_receipt is null),
      current_date, 80.07, null,
      '[{"line_kind":"account","account_id":"00000000-0000-0000-0000-00000000ad01","amount":80.07}]'::jsonb,
      '[]'::jsonb, 1000)$$,
  'a payment order edit can change the rate'
);

select is(
  pg_temp.live_role_amount('payment_orders',
    (select usd_receipt from t_ids where ars_receipt is null), 'banco', 'credit'),
  80070.00::numeric,
  'a rate change re-posts the payment order at the new rate'
);

select * from finish();

rollback;
