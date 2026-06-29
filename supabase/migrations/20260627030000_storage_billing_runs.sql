-- Fase H.3 — Registro de facturación de almacenaje (storage_billing_runs).
--
-- Cada fila = un período facturado para un cliente (semana/quincena/mes o el
-- rango que sea), con el comprobante emitido. Sirve para:
--   (a) evitar doble facturación (no se puede solapar un período ya facturado),
--   (b) saber hasta qué fecha se facturó cada cliente y autocontinuar el desde,
--   (c) detectar huecos sin facturar.
-- El desglose se guarda igual que en la factura: almacenaje + carga + descarga.
--
-- RLS: owner/admin/finance (perms storage_billing:*), igual que storage_tariffs.

set row_security = off;

create table public.storage_billing_runs (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients (id) on delete restrict,
  period_start        date not null,
  period_end          date not null,
  storage_total       numeric(14, 2) not null default 0 check (storage_total >= 0),
  handling_in_total   numeric(14, 2) not null default 0 check (handling_in_total >= 0),
  handling_out_total  numeric(14, 2) not null default 0 check (handling_out_total >= 0),
  total               numeric(14, 2) not null default 0 check (total >= 0),
  invoice_id          uuid references public.invoices (id) on delete set null,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),

  constraint storage_billing_runs_period
    check (period_end >= period_start)
);

comment on table public.storage_billing_runs is
  'Períodos de almacenaje ya facturados por cliente. Evita doble facturación, marca hasta cuándo se facturó cada cliente y permite detectar huecos.';

create index storage_billing_runs_client_idx
  on public.storage_billing_runs (client_id, period_end desc);

------------------------------------------------------------------------------
-- RLS — gestionado por owner/admin/finance
------------------------------------------------------------------------------
alter table public.storage_billing_runs enable row level security;

create policy "storage_billing_runs select"
  on public.storage_billing_runs for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));
create policy "storage_billing_runs insert"
  on public.storage_billing_runs for insert to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'finance']));
create policy "storage_billing_runs delete"
  on public.storage_billing_runs for delete to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));
