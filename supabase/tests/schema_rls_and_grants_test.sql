-- Schema-wide floor for RLS, policies and function grants in `public`.
-- Generic on purpose: per-table role checks live in their own files.
-- Runs in CI through `supabase test db` (pg_prove); each file is its own
-- transaction and rolls back.

begin;

select plan(9);

select is_empty(
  $$
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  $$,
  'every public table has RLS enabled'
);

-- A policy for anon or PUBLIC would let an unauthenticated request through.
select is_empty(
  $$
    select schemaname || '.' || tablename || ' / ' || policyname
    from pg_policies
    where roles && array['anon', 'public']::name[]
  $$,
  'no policy targets anon or public'
);

-- RLS on with no policy denies everything, which is right only for a table
-- the service role alone uses; those are listed with why.
select is_empty(
  $$
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname
      )
      and c.relname not in (
        'afip_ta_cache',       -- WSAA tokens: service role only
        'padron_cache',        -- AFIP padrón lookups: service role only
        'rate_limit_buckets',  -- rate limiter state: service role only
        'search_index_state'   -- search refresh bookkeeping: service role only
      )
  $$,
  'every table authenticated can reach has a policy'
);

-- Wrapped in a sub-select the role check runs once per statement; bare, it
-- runs once per row.
select is_empty(
  $$
    select tablename || ' / ' || policyname
    from pg_policies,
      lateral (select coalesce(qual, '') || ' ' || coalesce(with_check, '') as e) x
    where schemaname = 'public'
      and regexp_count(x.e, '(public\.)?user_has_role\(')
        <> regexp_count(x.e, 'SELECT\s+(public\.)?user_has_role\(')
  $$,
  'every user_has_role() call in a policy is wrapped in (select …)'
);

select is_empty(
  $$
    select tablename || ' / ' || policyname
    from pg_policies
    where schemaname = 'public'
      and permissive = 'PERMISSIVE'
      and cmd in ('UPDATE', 'ALL')
      and with_check is null
      and qual is not null
  $$,
  'every permissive UPDATE/ALL policy has WITH CHECK'
);

select is_empty(
  $$
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) c
        where c like 'search_path=%'
      )
  $$,
  'every SECURITY DEFINER function in public sets search_path'
);

select ok(
  not has_function_privilege('anon', 'public.bootstrap_first_owner(uuid)', 'execute'),
  'anon cannot run bootstrap_first_owner'
);

select ok(
  not has_function_privilege('authenticated', 'public.bootstrap_first_owner(uuid)', 'execute'),
  'authenticated cannot run bootstrap_first_owner'
);

select ok(
  has_function_privilege('authenticated', 'public.user_has_role(text[])', 'execute'),
  'authenticated can run user_has_role (every policy calls it)'
);

select * from finish(true);

rollback;
