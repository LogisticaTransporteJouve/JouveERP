-- Resultado de gestión, a USD loan disbursement without an exchange rate
-- (20261103130000): in cash it comes back as "Financiamiento recibido" in
-- dollars (pending_usd), never converted at 1 nor at 0; the drill-down keeps
-- it in dollars too. No seed rate is as old as 1990. One transaction, rolled
-- back.

begin;

select plan(5);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000002301a1', 'Banco Dólares Desembolso', 'bank', 'USD');

insert into public.loans (id, channel_id, currency, description, first_due_date, installments_count, kind, principal)
values ('00000000-0000-0000-0000-0000002301b1', 'jouve_internal', 'USD', 'Préstamo USD sin cotización',
        '1990-07-01', 1, 'prestamo', 2500);

create temp table t_disbursement as
select public.record_loan_disbursement('00000000-0000-0000-0000-0000002301b1',
  '00000000-0000-0000-0000-0000002301a1', '1990-06-15', null) as id;

set constraints all immediate;

select is(
  public.get_exchange_rate('USD', '1990-06-15'),
  null,
  'there is no rate on or before the date'
);

-- Materialized: the RPCs are SRFs read several times below.
create temp table cash as
select * from public.get_management_pnl('1990-06-01', '1990-06-30', 'cash', false);

select results_eq(
  $$select bucket, channel_side, amount_ars, pending_usd
      from cash where bucket = 'loan_disbursements'$$,
  $$values ('loan_disbursements'::text, 'internal'::text, 0.00::numeric, 2500.00::numeric)$$,
  'cash: the disbursement is financing received in dollars, pending_usd, zero pesos'
);

select is(
  (select coalesce(sum(amount_ars), 0) from cash),
  0::numeric,
  'cash: no peso figure moves'
);

select is(
  (select count(*)::int
     from public.get_management_pnl('1990-06-01', '1990-06-30', 'accrual', false)
    where bucket = 'loan_disbursements'),
  0,
  'accrual: there is no financing-received line'
);

create temp table docs as
select * from public.get_management_pnl_documents('1990-06-01', '1990-06-30', 'cash',
  array['loan_disbursements']);

select results_eq(
  $$select doc_type, amount_ars, pending_usd from docs
     where doc_id = '00000000-0000-0000-0000-0000002301b1'$$,
  $$values ('loan'::text, 0.00::numeric, 2500.00::numeric)$$,
  'the drill-down opens the loan with the dollars pending'
);

select * from finish();
rollback;
