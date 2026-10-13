-- Performance + correctness pass (no business-rule change).
--
-- 1. SQL aggregates for treasury / cash flow. Both actions used to fetch every
--    `transactions` row up to today and sum in JS; PostgREST caps responses at
--    max_rows (1000, supabase/config.toml), so once the table passed 1000 rows
--    balances were silently computed from a truncated set. The sums now run in
--    Postgres and return one row per account (or per account × month × kind ×
--    scope), which the actions still drain page by page.
--    SECURITY INVOKER: callers use the RLS user client and transactions RLS
--    keeps applying exactly as with the old direct reads.
-- 2. RLS initplan: every policy calling public.user_has_role(...) unwrapped is
--    rewritten to `(select public.user_has_role(...))`, so Postgres evaluates it
--    once per statement (InitPlan) instead of once per row. Same semantics: the
--    function is STABLE and its arguments are constants.
-- 3. Missing indexes (consolidated libro IVA by date, checks FKs).

-- ALTER POLICY / CREATE INDEX take table locks; fail fast instead of queueing
-- behind live traffic (rerun at a quieter moment).
set lock_timeout = '10s';

set row_security = off;

------------------------------------------------------------------------------
-- 1. Aggregate RPCs
------------------------------------------------------------------------------

-- Signed movement totals per account. income/transfer_in add, expense/
-- transfer_out subtract (the only four kinds the transactions CHECK allows).
--   net_until       = Σ signed amount with transaction_date <= p_until
--   net_until_split = Σ signed amount with transaction_date <= p_split
--                     (p_split <= p_until; 0 when the account has none)
--   last_movement_date = latest transaction_date <= p_until
create or replace function public.account_movement_totals(
  p_until date,
  p_split date
)
returns table(
  account_id uuid,
  net_until numeric,
  net_until_split numeric,
  last_movement_date date
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    t.account_id,
    sum(case when t.kind in ('income', 'transfer_in') then t.amount else -t.amount end)
      as net_until,
    coalesce(
      sum(case when t.kind in ('income', 'transfer_in') then t.amount else -t.amount end)
        filter (where t.transaction_date <= p_split),
      0
    ) as net_until_split,
    max(t.transaction_date) as last_movement_date
  from public.transactions t
  where t.transaction_date <= p_until
  group by t.account_id
  order by t.account_id;
$$;

revoke all on function public.account_movement_totals(date, date) from public, anon;
grant execute on function public.account_movement_totals(date, date) to authenticated;

comment on function public.account_movement_totals(date, date) is
  'Per-account signed transaction totals up to p_until and up to p_split, plus last movement date. Security invoker (transactions RLS applies).';

-- Realized income / expense per account × month × kind × channel scope, for
-- transactions in [p_from, p_until]. scope mirrors the cash-flow view:
-- 'facturado' (fiscal channel), 'interno' (internal channel), 'otro' (channel
-- not visible to the caller).
create or replace function public.transaction_monthly_flows(
  p_from date,
  p_until date
)
returns table(
  account_id uuid,
  month text,
  kind text,
  scope text,
  total numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    t.account_id,
    to_char(t.transaction_date, 'YYYY-MM') as month,
    t.kind,
    case
      when c.is_fiscal is null then 'otro'
      when c.is_fiscal then 'facturado'
      else 'interno'
    end as scope,
    sum(t.amount) as total
  from public.transactions t
  left join public.invoicing_channels c on c.id = t.channel_id
  where t.kind in ('income', 'expense')
    and t.transaction_date >= p_from
    and t.transaction_date <= p_until
  group by 1, 2, 3, 4
  order by 1, 2, 3, 4;
$$;

revoke all on function public.transaction_monthly_flows(date, date) from public, anon;
grant execute on function public.transaction_monthly_flows(date, date) to authenticated;

comment on function public.transaction_monthly_flows(date, date) is
  'Income/expense totals per account, month (YYYY-MM), kind and channel scope (facturado/interno/otro) within [p_from, p_until]. Security invoker.';

------------------------------------------------------------------------------
-- 2. RLS initplan: wrap user_has_role(...) in a scalar subquery
------------------------------------------------------------------------------
-- Rewrites the LIVE policies (pg_policy) instead of re-stating them from older
-- migrations, so it is immune to the drop/recreate history and cannot drift
-- from what is actually deployed. ALTER POLICY only swaps the expressions; the
-- policy name, command, roles and permissive/restrictive flag are untouched.
--
-- With search_path = '' pg_get_expr() schema-qualifies every object, so the
-- deparsed text re-parses to the very same objects. An unwrapped call deparses
-- as `public.user_has_role(ARRAY['owner'::text, ...])`; an already-wrapped one
-- as `( SELECT public.user_has_role(...) AS user_has_role)` — the lookbehind
-- skips those, which makes the block idempotent. If any call survives the
-- rewrite (an unexpected argument shape), the migration aborts instead of
-- leaving a half-converted state.

do $$
declare
  v_old_path text := current_setting('search_path');
  v_pattern constant text := '(?<!SELECT )public\.user_has_role\((ARRAY\[[^]]*\])\)';
  v_replacement constant text := '(SELECT public.user_has_role(\1))';
  r record;
  v_qual text;
  v_check text;
  v_sql text;
  v_remaining int;
begin
  perform set_config('search_path', '', true);

  for r in
    select
      p.polname,
      n.nspname,
      c.relname,
      pg_get_expr(p.polqual, p.polrelid)      as qual,
      pg_get_expr(p.polwithcheck, p.polrelid) as with_check
    from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'storage')
  loop
    v_qual := r.qual;
    v_check := r.with_check;
    if v_qual is not null and v_qual ~ v_pattern then
      v_qual := regexp_replace(v_qual, v_pattern, v_replacement, 'g');
    else
      v_qual := null; -- unchanged: leave USING as is
    end if;
    if v_check is not null and v_check ~ v_pattern then
      v_check := regexp_replace(v_check, v_pattern, v_replacement, 'g');
    else
      v_check := null; -- unchanged: leave WITH CHECK as is
    end if;

    if v_qual is null and v_check is null then
      continue;
    end if;

    v_sql := format('alter policy %I on %I.%I', r.polname, r.nspname, r.relname);
    if v_qual is not null then
      v_sql := v_sql || format(' using (%s)', v_qual);
    end if;
    if v_check is not null then
      v_sql := v_sql || format(' with check (%s)', v_check);
    end if;
    execute v_sql;
  end loop;

  select count(*) into v_remaining
    from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'storage')
     and (
       coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~ '(?<!SELECT )public\.user_has_role\('
       or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ '(?<!SELECT )public\.user_has_role\('
     );
  if v_remaining > 0 then
    raise exception 'RLS initplan rewrite left % policies with an unwrapped user_has_role call', v_remaining;
  end if;

  perform set_config('search_path', v_old_path, true);
end;
$$;

------------------------------------------------------------------------------
-- 3. Indexes
------------------------------------------------------------------------------

-- Consolidated libro IVA (no channel filter) ranges on fecha alone; the
-- existing (channel_id, fecha) indexes can't serve that range directly.
-- (purchase_invoices already has purchase_invoices_fecha_idx.)
create index if not exists invoices_fecha_idx
  on public.invoices (fecha);

-- Unindexed foreign keys on checks (FK checks on delete/update of the parent
-- and the joins from receipts / account statements).
create index if not exists checks_source_payment_line_idx
  on public.checks (source_payment_line_id)
  where source_payment_line_id is not null;
create index if not exists checks_cartera_account_idx
  on public.checks (cartera_account_id);

set row_security = on;
