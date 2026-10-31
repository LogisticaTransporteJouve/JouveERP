SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Aging by scope (A2): the same shape as v_client_aging / v_supplier_aging,
-- grouped by (counterparty, channel_is_fiscal). With the "Todos" scope the app
-- keeps reading v_*_aging; with "Solo fiscal" or "Solo interno" it reads these
-- views filtered by channel_is_fiscal, one row per counterparty. Documents with
-- no channel (channel_is_fiscal NULL) only appear under "Todos".
-- Additive: nothing existing changes.

create view public.v_client_aging_by_scope with (security_invoker = on) as
  select
    d.client_id as client_id,
    d.channel_is_fiscal as channel_is_fiscal,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '0_30'), 0) as ars_bucket_0_30,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '30_60'), 0) as ars_bucket_30_60,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '60_90'), 0) as ars_bucket_60_90,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '90_plus'), 0) as ars_bucket_90_plus,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD')), 0) as ars_total_open,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '0_30'), 0) as usd_bucket_0_30,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '30_60'), 0) as usd_bucket_30_60,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '60_90'), 0) as usd_bucket_60_90,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '90_plus'), 0) as usd_bucket_90_plus,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD')), 0) as usd_total_open,
    count(*) as document_count,
    max(d.days_overdue) as oldest_days
  from public.v_aging_documents d
  group by d.client_id, d.channel_is_fiscal;

comment on view public.v_client_aging_by_scope is
  'Aging por cliente y alcance (channel_is_fiscal), separado por moneda. Una fila por cliente al filtrar channel_is_fiscal. Permiso: clients:read + invoices:read + receipts:read.';

create view public.v_supplier_aging_by_scope with (security_invoker = on) as
  select
    d.supplier_id as supplier_id,
    d.channel_is_fiscal as channel_is_fiscal,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '0_30'), 0) as ars_bucket_0_30,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '30_60'), 0) as ars_bucket_30_60,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '60_90'), 0) as ars_bucket_60_90,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '90_plus'), 0) as ars_bucket_90_plus,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD')), 0) as ars_total_open,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '0_30'), 0) as usd_bucket_0_30,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '30_60'), 0) as usd_bucket_30_60,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '60_90'), 0) as usd_bucket_60_90,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '90_plus'), 0) as usd_bucket_90_plus,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD')), 0) as usd_total_open,
    count(*) as document_count,
    max(d.days_overdue) as oldest_days
  from public.v_supplier_aging_documents d
  group by d.supplier_id, d.channel_is_fiscal;

comment on view public.v_supplier_aging_by_scope is
  'Aging por proveedor y alcance (channel_is_fiscal), separado por moneda. Una fila por proveedor al filtrar channel_is_fiscal. Permiso: suppliers:read + purchase_invoices:read + payment_orders:read.';

revoke all on table public.v_client_aging_by_scope from public, anon;
revoke all on table public.v_supplier_aging_by_scope from public, anon;
grant select on table public.v_client_aging_by_scope to authenticated, service_role;
grant select on table public.v_supplier_aging_by_scope to authenticated, service_role;
