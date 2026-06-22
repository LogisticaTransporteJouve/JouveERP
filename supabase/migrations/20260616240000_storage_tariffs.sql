-- Fase H.2 — Tarifas de almacenaje con vigencia temporal (storage_tariffs).
--
-- Modelo estándar 3PL (supuesto documentado, ajustable): una tarifa = precio
-- por pallet por período (diario/mensual) vigente en un rango de fechas, para
-- un cliente (o general si client_id es null). El cálculo de facturación (H.3)
-- elige la tarifa vigente — la específica del cliente gana sobre la general —
-- y cobra días-pallet del período. docs/roadmap.md Fase H.2/H.3.
--
-- RLS: pricing → owner/admin/finance (perms storage_billing:*).

set row_security = off;

create table public.storage_tariffs (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid references public.clients (id) on delete cascade,
  rate_per_pallet  numeric(14, 2) not null check (rate_per_pallet > 0),
  period           text not null default 'monthly'
                     check (period in ('daily', 'monthly')),
  valid_from       date not null,
  valid_to         date,
  is_active        boolean not null default true,
  notes            text,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint storage_tariffs_valid_range
    check (valid_to is null or valid_to >= valid_from)
);

comment on table public.storage_tariffs is
  'Tarifas de almacenaje (precio por pallet por período) con vigencia. client_id null = tarifa general; la específica del cliente gana. Insumo del cálculo de facturación (H.3).';

create index storage_tariffs_client_idx
  on public.storage_tariffs (client_id, valid_from desc);
create index storage_tariffs_active_idx
  on public.storage_tariffs (is_active, valid_from);

create trigger storage_tariffs_set_updated_at
  before update on public.storage_tariffs
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- RLS — pricing gestionado por owner/admin/finance
------------------------------------------------------------------------------
alter table public.storage_tariffs enable row level security;

create policy "storage_tariffs select"
  on public.storage_tariffs for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));
create policy "storage_tariffs insert"
  on public.storage_tariffs for insert to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'finance']));
create policy "storage_tariffs update"
  on public.storage_tariffs for update to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));
create policy "storage_tariffs delete"
  on public.storage_tariffs for delete to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));
