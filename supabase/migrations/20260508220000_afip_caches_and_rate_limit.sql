-- C.2 — AFIP caches and per-user rate limiting.
--
-- Three internal tables — none of them user-readable. We keep RLS enabled
-- with zero policies so authenticated clients cannot reach the rows; only
-- the service-role client (lib/supabase/service.ts) can.
--   - afip_ta_cache:    one row per AFIP service holding a 12h Ticket de
--                       Acceso (token + sign). AFIP rejects fresh requests
--                       while the previous TA is still valid, so caching
--                       is mandatory.
--   - padron_cache:     one row per CUIT with the last successful padrón A4
--                       lookup. 24h TTL with stale-fallback at the action
--                       layer when AFIP is unreachable.
--   - rate_limit_buckets: per (user_id, bucket_key, window_start) counter
--                       used by lib/rate-limit.ts to throttle CUIT lookups
--                       at 60/h per user.
--
-- The bump_rate_limit_bucket RPC performs an atomic insert-or-increment in
-- a single round-trip and replaces the buggy upsert+manual-fallback in the
-- legacy implementation.

set row_security = off;

------------------------------------------------------------------------------
-- 1. afip_ta_cache
------------------------------------------------------------------------------
create table public.afip_ta_cache (
  service          text primary key,
  token            text not null,
  sign             text not null,
  expiration_time  timestamptz not null,
  cached_at        timestamptz not null default now()
);

comment on table public.afip_ta_cache is 'WSAA Tickets de Acceso. Service-role only.';

create index afip_ta_cache_expiration_idx
  on public.afip_ta_cache (expiration_time);

alter table public.afip_ta_cache enable row level security;
-- No policies → only service role can access.

------------------------------------------------------------------------------
-- 2. padron_cache
------------------------------------------------------------------------------
create table public.padron_cache (
  cuit       text primary key,
  data       jsonb not null,
  cached_at  timestamptz not null default now()
);

comment on table public.padron_cache is 'AFIP padrón A4 results. 24h TTL. Service-role only.';

create index padron_cache_cached_at_idx
  on public.padron_cache (cached_at desc);

alter table public.padron_cache enable row level security;
-- No policies → only service role can access.

------------------------------------------------------------------------------
-- 3. rate_limit_buckets
------------------------------------------------------------------------------
create table public.rate_limit_buckets (
  user_id       uuid not null references auth.users (id) on delete cascade,
  bucket_key    text not null,
  window_start  timestamptz not null,
  count         int not null default 0,
  primary key (user_id, bucket_key, window_start)
);

comment on table public.rate_limit_buckets is 'Per-user rate-limit counters per fixed time window. Service-role only.';

create index rate_limit_buckets_window_idx
  on public.rate_limit_buckets (window_start);

alter table public.rate_limit_buckets enable row level security;
-- No policies → only service role can access.

------------------------------------------------------------------------------
-- 4. bump_rate_limit_bucket — atomic insert-or-increment
------------------------------------------------------------------------------
-- Returns the post-increment count. Callers throw if it exceeds the limit.
-- security definer so the service-role-only table is reachable through this
-- function even if a future caller forgets to use the service client. The
-- search_path lock-down protects against shadowed-name attacks.
create or replace function public.bump_rate_limit_bucket(
  p_user_id      uuid,
  p_bucket_key   text,
  p_window_start timestamptz
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.rate_limit_buckets
    (user_id, bucket_key, window_start, count)
    values (p_user_id, p_bucket_key, p_window_start, 1)
  on conflict (user_id, bucket_key, window_start) do update
    set count = public.rate_limit_buckets.count + 1
  returning count into v_count;
  return v_count;
end;
$$;

revoke all on function public.bump_rate_limit_bucket(uuid, text, timestamptz) from public;
grant execute on function public.bump_rate_limit_bucket(uuid, text, timestamptz) to service_role;

set row_security = on;
