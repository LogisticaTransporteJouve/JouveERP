-- Fotos del aging (20261104000100). capture_aging_snapshot writes today's
-- row with the sums of v_aging_documents (pesos and dollars apart, overdue
-- = days past due > 0); a second run the same day replaces it. Only the
-- service role runs it; owner/admin/finance read the rows, operations does
-- not, and nobody writes them through the API. One transaction, rolled back.

begin;

select plan(9);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000001105a1', 'finance@aging-snap.test'),
  ('00000000-0000-0000-0000-0000001105a2', 'operations@aging-snap.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000001105a1', 'finance'),
  ('00000000-0000-0000-0000-0000001105a2', 'operations');

-- 1. Grants --------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.capture_aging_snapshot()', 'execute')
  and not has_function_privilege('anon', 'public.capture_aging_snapshot()', 'execute')
  and has_function_privilege('service_role', 'public.capture_aging_snapshot()', 'execute'),
  'only the service role captures the aging'
);
select ok(
  has_table_privilege('authenticated', 'public.aging_snapshots', 'select')
  and not has_table_privilege('authenticated', 'public.aging_snapshots', 'insert')
  and not has_table_privilege('authenticated', 'public.aging_snapshots', 'update')
  and not has_table_privilege('anon', 'public.aging_snapshots', 'select'),
  'authenticated only reads the snapshots'
);

-- 2. Capture ------------------------------------------------------------------------

-- Materialized before comparing: the view reads current_date.
create temporary table t_expected as
  select
    coalesce(sum(open_amount) filter (where coalesce(moneda, 'PES') not in ('DOL', 'USD')), 0)::numeric(18,2) as ars_total_open,
    coalesce(sum(open_amount) filter (where coalesce(moneda, 'PES') not in ('DOL', 'USD') and days_overdue > 0), 0)::numeric(18,2) as ars_overdue,
    coalesce(sum(open_amount) filter (where coalesce(moneda, 'PES') in ('DOL', 'USD')), 0)::numeric(18,2) as usd_total_open,
    coalesce(sum(open_amount) filter (where coalesce(moneda, 'PES') in ('DOL', 'USD') and days_overdue > 0), 0)::numeric(18,2) as usd_overdue,
    count(*) as document_count
  from public.v_aging_documents;

select is(public.capture_aging_snapshot(), current_date, 'the capture returns today');
select results_eq(
  $$select ars_total_open, ars_overdue, usd_total_open, usd_overdue, document_count
      from public.aging_snapshots where snapshot_date = current_date$$,
  $$select ars_total_open, ars_overdue, usd_total_open, usd_overdue, document_count from t_expected$$,
  'today''s row has the sums of v_aging_documents'
);
select is(
  (select ars_bucket_0_30 + ars_bucket_30_60 + ars_bucket_60_90 + ars_bucket_90_plus
     from public.aging_snapshots where snapshot_date = current_date),
  (select ars_total_open from t_expected),
  'the peso buckets add up to the open total'
);

select lives_ok($$select public.capture_aging_snapshot()$$, 'a second run the same day');
select is(
  (select count(*)::int from public.aging_snapshots where snapshot_date = current_date),
  1, 'leaves one row for the day');

-- 3. RLS -----------------------------------------------------------------------------

set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001105a1","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.aging_snapshots where snapshot_date = current_date),
  1, 'finance reads the snapshot');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001105a2","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.aging_snapshots),
  0, 'operations does not');

reset role;

select * from finish();

rollback;
