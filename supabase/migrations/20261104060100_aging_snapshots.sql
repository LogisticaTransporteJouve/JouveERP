SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- AI CFO follow-up: history of the client aging, so the analyst can say
-- "la mora creció X % vs hace 30 días". Expand-only.
--
-- 1. aging_snapshots: one row per day with the client aging of every channel
--    (v_aging_documents, the same documents the Aging page sums): open
--    amount per bucket, the open total and the overdue total (days past the
--    due date > 0), pesos and dollars apart (dollars = moneda DOL/USD, as
--    v_client_aging counts them), plus how many documents and clients.
-- 2. capture_aging_snapshot(): writes today's row (CURRENT_DATE, the date
--    v_aging_documents ages against); a second run the same day replaces it.
--    The Inngest cron aging-snapshot calls it daily with the service role.
-- 3. ai_insights select: the new kind receivables_overdue_growth, by role,
--    mirroring INSIGHT_KIND_PERMISSION (features/ai/insights/lib/visibility.ts).
--
-- RLS: the roles that see the Aging page (clients:read + invoices:read +
-- receipts:read: owner, admin, finance) read the snapshots; nobody writes
-- them but the function.
--
-- Rollback: older code never reads aging_snapshots nor calls the function;
-- the analyst of an older deploy deletes only its own kinds, so a card of
-- the new kind stays until the next run of this code.

------------------------------------------------------------------------------
-- 1. aging_snapshots
------------------------------------------------------------------------------

create table public.aging_snapshots (
  snapshot_date       date primary key,
  ars_bucket_0_30     numeric(18,2) not null default 0,
  ars_bucket_30_60    numeric(18,2) not null default 0,
  ars_bucket_60_90    numeric(18,2) not null default 0,
  ars_bucket_90_plus  numeric(18,2) not null default 0,
  ars_total_open      numeric(18,2) not null default 0,
  ars_overdue         numeric(18,2) not null default 0,
  usd_bucket_0_30     numeric(18,2) not null default 0,
  usd_bucket_30_60    numeric(18,2) not null default 0,
  usd_bucket_60_90    numeric(18,2) not null default 0,
  usd_bucket_90_plus  numeric(18,2) not null default 0,
  usd_total_open      numeric(18,2) not null default 0,
  usd_overdue         numeric(18,2) not null default 0,
  document_count      bigint not null default 0 check (document_count >= 0),
  client_count        bigint not null default 0 check (client_count >= 0),
  captured_at         timestamptz not null default now()
);

comment on table public.aging_snapshots is
  'Foto diaria del aging de clientes (todos los canales): saldo abierto por tramo, total abierto y total vencido, en pesos y en dólares por separado. La escribe capture_aging_snapshot (cron aging-snapshot).';
comment on column public.aging_snapshots.ars_overdue is
  'Saldo abierto en pesos de los comprobantes y cheques rechazados ya vencidos (días de atraso > 0).';
comment on column public.aging_snapshots.usd_overdue is
  'Saldo abierto en dólares de los comprobantes y cheques rechazados ya vencidos (días de atraso > 0).';

alter table public.aging_snapshots enable row level security;

create policy "aging_snapshots select"
  on public.aging_snapshots for select
  to authenticated
  using ( (select public.user_has_role(array['owner', 'admin', 'finance'])) );

revoke all on table public.aging_snapshots from public, anon, authenticated;
grant select on table public.aging_snapshots to authenticated;

------------------------------------------------------------------------------
-- 2. capture_aging_snapshot
------------------------------------------------------------------------------

create function public.capture_aging_snapshot()
returns date
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin']) then
    raise exception 'No autorizado para registrar la foto del aging'
      using errcode = '42501';
  end if;

  insert into public.aging_snapshots as s (
    snapshot_date,
    ars_bucket_0_30, ars_bucket_30_60, ars_bucket_60_90, ars_bucket_90_plus,
    ars_total_open, ars_overdue,
    usd_bucket_0_30, usd_bucket_30_60, usd_bucket_60_90, usd_bucket_90_plus,
    usd_total_open, usd_overdue,
    document_count, client_count, captured_at
  )
  select
    current_date,
    coalesce(sum(d.open_amount) filter (where not d.is_usd and d.bucket = '0_30'), 0),
    coalesce(sum(d.open_amount) filter (where not d.is_usd and d.bucket = '30_60'), 0),
    coalesce(sum(d.open_amount) filter (where not d.is_usd and d.bucket = '60_90'), 0),
    coalesce(sum(d.open_amount) filter (where not d.is_usd and d.bucket = '90_plus'), 0),
    coalesce(sum(d.open_amount) filter (where not d.is_usd), 0),
    coalesce(sum(d.open_amount) filter (where not d.is_usd and d.days_overdue > 0), 0),
    coalesce(sum(d.open_amount) filter (where d.is_usd and d.bucket = '0_30'), 0),
    coalesce(sum(d.open_amount) filter (where d.is_usd and d.bucket = '30_60'), 0),
    coalesce(sum(d.open_amount) filter (where d.is_usd and d.bucket = '60_90'), 0),
    coalesce(sum(d.open_amount) filter (where d.is_usd and d.bucket = '90_plus'), 0),
    coalesce(sum(d.open_amount) filter (where d.is_usd), 0),
    coalesce(sum(d.open_amount) filter (where d.is_usd and d.days_overdue > 0), 0),
    count(*),
    count(distinct d.client_id),
    now()
  from (
    select a.client_id, a.open_amount, a.bucket, a.days_overdue,
           coalesce(a.moneda, 'PES') in ('DOL', 'USD') as is_usd
      from public.v_aging_documents a
  ) d
  on conflict (snapshot_date) do update set
    ars_bucket_0_30    = excluded.ars_bucket_0_30,
    ars_bucket_30_60   = excluded.ars_bucket_30_60,
    ars_bucket_60_90   = excluded.ars_bucket_60_90,
    ars_bucket_90_plus = excluded.ars_bucket_90_plus,
    ars_total_open     = excluded.ars_total_open,
    ars_overdue        = excluded.ars_overdue,
    usd_bucket_0_30    = excluded.usd_bucket_0_30,
    usd_bucket_30_60   = excluded.usd_bucket_30_60,
    usd_bucket_60_90   = excluded.usd_bucket_60_90,
    usd_bucket_90_plus = excluded.usd_bucket_90_plus,
    usd_total_open     = excluded.usd_total_open,
    usd_overdue        = excluded.usd_overdue,
    document_count     = excluded.document_count,
    client_count       = excluded.client_count,
    captured_at        = excluded.captured_at;

  return current_date;
end;
$$;

comment on function public.capture_aging_snapshot() is
  'Guarda (o reemplaza) la foto del aging de clientes de hoy en aging_snapshots. La llama el cron aging-snapshot.';

revoke all on function public.capture_aging_snapshot() from public, anon, authenticated;
grant execute on function public.capture_aging_snapshot() to service_role;

------------------------------------------------------------------------------
-- 3. ai_insights select — receivables_overdue_growth
------------------------------------------------------------------------------

-- Same as 20261103180000 plus receivables_overdue_growth for finance.
drop policy if exists "ai_insights select" on public.ai_insights;

create policy "ai_insights select"
  on public.ai_insights for select
  to authenticated
  using (
    (select public.user_has_role(array['owner', 'admin']))
    or (
      kind in ('cashflow', 'receivables_risk', 'dup_invoice', 'unusual_amount', 'client_margin_drop', 'late_interest_uncharged', 'unreconciled_bank_lines', 'pending_driver_settlements', 'loan_installments_due', 'cash_vs_financing', 'receivables_overdue_growth')
      and (select public.user_has_role(array['finance']))
    )
    or (
      kind in ('fleet_doc_expiry', 'trip_margin', 'vehicle_cost_per_km', 'fuel_consumption_outlier')
      and (select public.user_has_role(array['operations']))
    )
  );
