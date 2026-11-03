-- W1 · S3 #19 (20261104102400): an IVA document that only carries a saldo a
-- favor opens no "Pagar IVA" task; one with an amount still does. One
-- transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(2);

insert into public.tax_documents (id, kind, period, due_date, amount, credit_balance) values
  ('00000000-0000-0000-0000-000000102401', 'iva', '2098-01', current_date + 3, null, 5000),
  ('00000000-0000-0000-0000-000000102402', 'iva', '2098-02', current_date + 3, 1000, null);

-- Materialized first: the sync's inserts are not visible to the same query.
create temp table t_sync on commit drop as
  select * from public.sync_automatic_tasks(current_date);

select is(
  (select count(*)::int from public.tasks
    where source_table = 'tax_documents'
      and source_id = '00000000-0000-0000-0000-000000102401'),
  0,
  'a month that only leaves a saldo a favor has nothing to pay'
);

select is(
  (select count(*)::int from public.tasks
    where source_table = 'tax_documents'
      and source_id = '00000000-0000-0000-0000-000000102402'
      and status = 'open'),
  1,
  'a month with an amount still gets its "Pagar IVA" task'
);

select * from finish();
rollback;
