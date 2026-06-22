-- M.2 — Multimoneda USD: cotización oficial USD→ARS (exchange_rates).
--
-- Modelo estándar (supuesto documentado, ajustable): la referencia es la
-- cotización oficial del BCRA. Un cron diario (Inngest `bcra-exchange-rate`)
-- trae la última cotización y la inserta con source='bcra'; finance puede
-- cargar/override una cotización manual (source='manual') como fallback si el
-- BCRA está caído. Para convertir un monto USD a ARS se usa la cotización de
-- la fecha de la operación (o la anterior más cercana). `rate` = ARS por 1 USD.
-- docs/pendientes.md §2 (M.2); docs/roadmap.md.

set row_security = off;

create table public.exchange_rates (
  id          uuid primary key default gen_random_uuid(),
  currency    text not null default 'USD' check (currency = 'USD'),
  rate_date   date not null,
  -- ARS por 1 unidad de `currency`.
  rate        numeric(18, 6) not null check (rate > 0),
  source      text not null default 'manual'
                check (source in ('bcra', 'manual')),
  notes       text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint exchange_rates_currency_date_unique unique (currency, rate_date)
);

comment on table public.exchange_rates is
  'Cotización oficial USD→ARS (rate = ARS por 1 USD). source bcra (cron) o manual (override de finance). Una fila por (currency, rate_date).';

-- Sin índice explícito sobre (currency, rate_date): el índice implícito del
-- UNIQUE constraint ya cubre las queries (eq currency + lte/order by rate_date
-- via leading-equality + backward scan). Mismo criterio que
-- 20260517830000_drop_redundant_indexes.sql.

create trigger exchange_rates_set_updated_at
  before update on public.exchange_rates
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- RLS — referencia contable: lectura para autenticados, gestión owner/admin/
-- finance (mismo patrón que inflation_adjustments / cost_centers).
------------------------------------------------------------------------------
alter table public.exchange_rates enable row level security;

create policy "Authenticated can view exchange_rates"
  on public.exchange_rates for select to authenticated using (true);

create policy "Owners/admins/finance can manage exchange_rates"
  on public.exchange_rates for all to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

set row_security = on;
