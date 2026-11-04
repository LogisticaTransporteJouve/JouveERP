-- Resultado de gestión, checks in cash and fiscal USD pending
-- (20261104092000): a check imported at go-live is an opening item (its
-- cartera inflow and its rejection are neutral); the outflow of a rejected
-- check takes back, in Servicios, the collection the check counted; a fiscal
-- USD movement stays pending while it has no live entry, even once a rate is
-- loaded for its date. No seed rate is as old as 1990. One transaction,
-- rolled back.

begin;

select plan(8);

-- The fixture inserts an imported check by hand; in the app only
-- commit_import_run does (guard_check_import_run). Disabled before any write,
-- while no trigger event is pending.
alter table public.checks disable trigger checks_guard_import_run;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000009200a1', 'Cartera Gestión Cheques', 'checks', 'ARS'),
  ('00000000-0000-0000-0000-0000009200a2', 'Banco Gestión Cheques', 'bank', 'ARS'),
  ('00000000-0000-0000-0000-0000009200a3', 'Banco Dólares Gestión', 'bank', 'USD');

insert into public.import_runs (id, kind, file_name, file_sha256, total_rows) values
  ('00000000-0000-0000-0000-0000009200f1', 'checks', 'cartera.csv', repeat('9', 64), 1);

-- A check loaded by hand (it counts as a collection) and one imported at
-- go-live (it does not). checks_manual_inflow books both inflows today.
insert into public.checks
  (id, kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
   cartera_account_id, status, source_kind, channel_id, import_run_id)
values
  ('00000000-0000-0000-0000-0000009200c1', 'fisico', 'GC-1', 'Banco X', 'Librador', current_date,
   current_date, 100, 'ARS', '00000000-0000-0000-0000-0000009200a1', 'en_cartera', 'manual',
   'jouve_fiscal', null),
  ('00000000-0000-0000-0000-0000009200c2', 'fisico', 'GC-2', 'Banco X', 'Librador', current_date,
   current_date, 300, 'ARS', '00000000-0000-0000-0000-0000009200a1', 'en_cartera', 'manual',
   'jouve_fiscal', '00000000-0000-0000-0000-0000009200f1');

-- The hand-loaded one is deposited and bounces (the bank debits it back);
-- the imported one bounces from the cartera.
select public.deposit_check('00000000-0000-0000-0000-0000009200c1', '00000000-0000-0000-0000-0000009200a2',
  current_date, null, null);
select public.reject_check('00000000-0000-0000-0000-0000009200c1', null, current_date, null, null);
select public.reject_check('00000000-0000-0000-0000-0000009200c2', null, current_date, null, null);

-- A fiscal and an internal USD expense dated before any rate.
insert into public.transactions
  (id, account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description)
values
  ('00000000-0000-0000-0000-0000009200e1', '00000000-0000-0000-0000-0000009200a3', 'jouve_fiscal',
   'expense', 50, 'USD', '1990-05-10', '1990-05-01', 'Gasto USD fiscal sin cotización'),
  ('00000000-0000-0000-0000-0000009200e2', '00000000-0000-0000-0000-0000009200a3', 'jouve_internal',
   'expense', 20, 'USD', '1990-05-10', '1990-05-01', 'Gasto USD interno sin cotización');

set constraints all immediate;

-- Materialized: volatile SRFs read several times below.
create temp table cash as
select * from public.management_pnl_lines(date_trunc('month', current_date)::date, current_date, 'cash');
create temp table check_tx as
select t.id, coalesce(t.manual_check_id, t.rejected_check_id) as check_id,
       case when t.manual_check_id is not null then 'inflow' else 'rejection' end as what
  from public.transactions t
 where coalesce(t.manual_check_id, t.rejected_check_id) in
       ('00000000-0000-0000-0000-0000009200c1', '00000000-0000-0000-0000-0000009200c2');
create temp table pending_before as
select * from public.management_pnl_lines('1990-05-01', '1990-05-31', 'accrual')
 where bucket = 'pending_usd';

-- A rate for the month, loaded later and back-dated. Nothing re-posts the
-- fiscal movement.
insert into public.exchange_rates (currency, rate_date, rate, source) values
  ('USD', '1990-05-01', 1000, 'manual');
create temp table accrual_after as
select * from public.management_pnl_lines('1990-05-01', '1990-05-31', 'accrual');

-- 1. Imported check: an opening item -------------------------------------------------

select is(
  (select count(*)::int from cash c join check_tx x on x.id = c.source_id
    where x.check_id = '00000000-0000-0000-0000-0000009200c2'),
  0,
  'an imported check''s inflow and its rejection reach no line'
);

-- 2. Rejected check: takes back the collection ----------------------------------------

select results_eq(
  $$select c.bucket, c.subbucket, c.chart_account_id, c.amount_ars
      from cash c join check_tx x on x.id = c.source_id
     where x.check_id = '00000000-0000-0000-0000-0000009200c1' and x.what = 'inflow'$$,
  $$values ('service_revenue'::text, null::text, null::uuid, 100::numeric)$$,
  'a hand-loaded check still counts as a collection'
);

select results_eq(
  $$select c.bucket, c.subbucket, c.chart_account_id, c.amount_ars
      from cash c join check_tx x on x.id = c.source_id
     where x.check_id = '00000000-0000-0000-0000-0000009200c1' and x.what = 'rejection'$$,
  $$values ('service_revenue'::text, null::text, null::uuid, -100::numeric)$$,
  'the bank''s debit-back of the bounced check takes it back from Servicios'
);

select is(
  (select sum(c.amount_ars) from cash c join check_tx x on x.id = c.source_id
    where x.check_id = '00000000-0000-0000-0000-0000009200c1'),
  0::numeric,
  'a collected check that bounced nets to nothing'
);

-- 3. Fiscal USD pending ---------------------------------------------------------------

select is(
  (select pending_usd from pending_before where source_id = '00000000-0000-0000-0000-0000009200e1'),
  -50::numeric,
  'a fiscal USD expense without a rate is pending'
);

select is(
  (select pending_usd from accrual_after
    where bucket = 'pending_usd' and source_id = '00000000-0000-0000-0000-0000009200e1'),
  -50::numeric,
  'with a back-dated rate but no entry yet, it stays pending instead of vanishing'
);

select is(
  (select count(*)::int from accrual_after
    where bucket = 'pending_usd' and source_id = '00000000-0000-0000-0000-0000009200e2'),
  0,
  'an internal USD expense leaves pending once its rate exists'
);

select is(
  (select sum(amount_ars) from accrual_after
    where source_table = 'transactions' and source_id = '00000000-0000-0000-0000-0000009200e2'),
  -20000::numeric,
  'and counts in pesos, built at the new rate'
);

select * from finish();
rollback;
