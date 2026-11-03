-- Resultado de gestión, loan disbursements (20261103130000): in cash, the
-- income a loan put in the bank is "Financiamiento recibido"
-- (loan_disbursements), positive, on the movement's date, and moves no
-- bucket of cash generation; in accrual it is absent; the drill-down lists
-- the loan and adds up to the figure. Deltas against the current month, so
-- seeds do not matter. One transaction, rolled back.

begin;

select plan(10);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Materialized: the RPCs are SRFs read several times below.
create function pg_temp.pnl(p_basis text, p_bucket text)
returns numeric
language sql as $$
  select coalesce(sum(amount_ars), 0)
    from public.get_management_pnl(current_date, current_date, p_basis, false)
   where bucket = p_bucket;
$$;

create temp table before as
select b.basis, k.bucket, pg_temp.pnl(b.basis, k.bucket) as v
  from (values ('accrual'), ('cash')) as b (basis)
  cross join (values ('service_revenue'), ('operating_cost'), ('unclassified'), ('financing_cost'),
                     ('loan_principal'), ('fleet_investment'), ('asset_sale'), ('employee_advances'),
                     ('loan_disbursements')) as k (bucket);

create temp table accrual_before as
select coalesce(sum(amount_ars), 0) as v
  from public.get_management_pnl(current_date, current_date, 'accrual', false);

create function pg_temp.delta(p_basis text, p_bucket text) returns numeric
language sql as $$
  select pg_temp.pnl(p_basis, p_bucket) - (select v from before where basis = p_basis and bucket = p_bucket)
$$;

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000001d5a01', 'Banco Desembolsos', 'bank', 'ARS');

insert into public.loans (id, channel_id, currency, description, first_due_date, installments_count, kind, principal)
values ('00000000-0000-0000-0000-0000001d5b01', 'jouve_internal', 'ARS', 'Préstamo desembolso gestión',
        current_date, 1, 'prestamo', 5000);

create temp table t_disbursement as
select public.record_loan_disbursement('00000000-0000-0000-0000-0000001d5b01',
  '00000000-0000-0000-0000-0000001d5a01', current_date, null) as id;

set constraints all immediate;

-- Cash ---------------------------------------------------------------------------------

select is(pg_temp.delta('cash', 'loan_disbursements'), 5000::numeric,
  'cash: the disbursement is financing received, positive');
select is(
  (select sum(pg_temp.delta('cash', k.bucket))
     from (values ('service_revenue'), ('operating_cost'), ('unclassified'), ('financing_cost'),
                  ('loan_principal'), ('fleet_investment'), ('asset_sale'), ('employee_advances')) as k (bucket)),
  0::numeric,
  'cash: and no bucket of cash generation moves'
);

create temp table cash_lines as
select * from public.get_management_pnl(current_date, current_date, 'cash', false)
 where bucket = 'loan_disbursements';

select is(
  (select count(*)::int from cash_lines where month = to_char(current_date, 'YYYY-MM')),
  (select count(*)::int from cash_lines),
  'cash: on the month of the movement'
);
select ok(
  (select bool_and(subbucket is null and channel_side = 'internal') from cash_lines),
  'cash: without subbucket, on the side of its channel'
);

-- Accrual ----------------------------------------------------------------------------

select is(
  (select count(*)::int
     from public.get_management_pnl(current_date, current_date, 'accrual', false)
    where bucket = 'loan_disbursements'),
  0,
  'accrual: there is no financing-received line'
);
select is(
  (select coalesce(sum(amount_ars), 0)
     from public.get_management_pnl(current_date, current_date, 'accrual', false))
    - (select v from accrual_before),
  0::numeric,
  'accrual: the disbursement is not P&L'
);

-- Drill-down ---------------------------------------------------------------------------

create temp table docs as
select * from public.get_management_pnl_documents(current_date, current_date, 'cash',
  array['loan_disbursements']);

select is(
  (select coalesce(sum(amount_ars), 0) from docs),
  pg_temp.pnl('cash', 'loan_disbursements'),
  'the disbursement documents add up to the figure'
);

create temp table our_doc as
select * from docs where doc_id = '00000000-0000-0000-0000-0000001d5b01';

select is(
  (select doc_type || ':' || doc_label || ':' || amount_ars from our_doc),
  'loan:Desembolso: Préstamo desembolso gestión:5000.00',
  'the drill-down opens the loan, named as its disbursement'
);
select is(
  (select doc_date from our_doc),
  current_date,
  'dated on the movement'
);

create temp table all_cash_docs as
select bucket, sum(amount_ars) as v
  from public.get_management_pnl_documents(current_date, current_date, 'cash')
 group by bucket;
create temp table all_cash as
select bucket, sum(amount_ars) as v
  from public.get_management_pnl(current_date, current_date, 'cash', false)
 group by bucket;

select set_eq(
  $$select bucket, v from all_cash$$,
  $$select bucket, v from all_cash_docs$$,
  'cash: the documents still add up to every figure'
);

select * from finish();
rollback;
