-- L closure — L.3 (libro mayor) + L.5 (balance/EERR/BG) + L.8 (ajuste inflación) + L.9 (centros de costo).
--
-- Las cuatro features comparten el mismo plano (contabilidad arriba de
-- journal_entries) y se mergean juntas para acelerar el cierre de Fase L.
--
-- L.3 — Libro Mayor:
--   get_ledger(account_id, from, to) → asientos de la cuenta con saldo running.
--   Saldo running se calcula con window function sum() over (order by date, line_id).
--
-- L.5 — Balance / EERR / BG:
--   get_account_balances(period_end, period_start nullable)
--     → para cada cuenta: total debit, total credit, balance final.
--     Filtra por accrual_period <= period_end y >= period_start si está.
--
-- L.8 — Ajuste por inflación:
--   Tabla inflation_adjustments con período, coeficiente, journal_entry_id
--   del asiento generado. UI completa el asiento de reexpresión.
--
-- L.9 — Centros de costo:
--   Tabla cost_centers + columna cost_center_id opcional en transactions,
--   invoices, purchase_invoices, payment_orders, receipts. journal_entries
--   también recibe cost_center_id (heredado del source). Reportes futuros
--   pueden filtrar EERR por centro.

set row_security = off;

------------------------------------------------------------------------------
-- 1. L.3 — RPC get_ledger
------------------------------------------------------------------------------
create or replace function public.get_ledger(
  p_account_id uuid,
  p_date_from  date default null,
  p_date_to    date default null
)
returns table (
  entry_id       uuid,
  line_id        uuid,
  entry_date     date,
  accrual_period text,
  description    text,
  source_table   text,
  source_id      uuid,
  channel_id     text,
  is_reversal    boolean,
  debit          numeric,
  credit         numeric,
  line_desc      text,
  running        numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with movs as (
    select
      je.id            as entry_id,
      jel.id           as line_id,
      je.entry_date,
      je.accrual_period,
      je.description,
      je.source_table,
      je.source_id,
      je.channel_id,
      je.is_reversal,
      jel.debit,
      jel.credit,
      jel.description  as line_desc
    from public.journal_entry_lines jel
    join public.journal_entries     je on je.id = jel.journal_entry_id
   where jel.chart_of_accounts_id = p_account_id
     and (p_date_from is null or je.entry_date >= p_date_from)
     and (p_date_to   is null or je.entry_date <= p_date_to)
  )
  select
    entry_id, line_id, entry_date, accrual_period, description,
    source_table, source_id, channel_id, is_reversal,
    debit, credit, line_desc,
    sum(debit - credit) over (order by entry_date asc, entry_id asc, line_id asc
                              rows between unbounded preceding and current row) as running
  from movs
  order by entry_date asc, entry_id asc, line_id asc;
$$;

comment on function public.get_ledger is
  'L.3 Libro Mayor: asientos de una cuenta con saldo running (Σ debit − Σ credit acumulado).';

revoke all on function public.get_ledger(uuid, date, date) from public;
grant execute on function public.get_ledger(uuid, date, date) to authenticated;

------------------------------------------------------------------------------
-- 2. L.5 — RPC get_account_balances
------------------------------------------------------------------------------
create or replace function public.get_account_balances(
  p_period_end   text,
  p_period_start text default null
)
returns table (
  account_id    uuid,
  account_code  text,
  account_name  text,
  account_type  public.coa_account_type,
  eerr_category text,
  total_debit   numeric,
  total_credit  numeric,
  balance       numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coa.id, coa.code, coa.name, coa.account_type, coa.eerr_category,
    coalesce(sum(jel.debit), 0)  as total_debit,
    coalesce(sum(jel.credit), 0) as total_credit,
    coalesce(sum(jel.debit - jel.credit), 0) as balance
  from public.chart_of_accounts coa
  left join public.journal_entry_lines jel on jel.chart_of_accounts_id = coa.id
  left join public.journal_entries je       on je.id = jel.journal_entry_id
     and je.accrual_period <= p_period_end
     and (p_period_start is null or je.accrual_period >= p_period_start)
   where coa.is_active = true
   group by coa.id, coa.code, coa.name, coa.account_type, coa.eerr_category
   having coalesce(sum(jel.debit), 0) <> 0 or coalesce(sum(jel.credit), 0) <> 0
   order by coa.code;
$$;

comment on function public.get_account_balances is
  'L.5 Balance: para cada cuenta activa, total débito/crédito/saldo acumulado hasta p_period_end (opcionalmente desde p_period_start). Filtra cuentas con movimientos.';

revoke all on function public.get_account_balances(text, text) from public;
grant execute on function public.get_account_balances(text, text) to authenticated;

------------------------------------------------------------------------------
-- 3. L.9 — Centros de costo
------------------------------------------------------------------------------
create table public.cost_centers (
  id           uuid         primary key default gen_random_uuid(),
  code         text         not null,
  name         text         not null,
  description  text,
  is_active    boolean      not null default true,
  created_at   timestamptz  not null default now(),
  updated_at   timestamptz  not null default now(),
  constraint cost_centers_code_unique unique (code),
  constraint cost_centers_code_format check (code ~ '^[A-Z0-9_-]+$')
);

comment on table public.cost_centers is
  'L.9 Centros de costo (dimensión contable). FK opcional en transactions, invoices, purchase_invoices, payment_orders, receipts y journal_entries.';

create index cost_centers_active_idx on public.cost_centers (is_active);

create trigger cost_centers_set_updated_at
  before update on public.cost_centers
  for each row execute function public.set_updated_at();

alter table public.cost_centers enable row level security;

create policy "Authenticated can view cost_centers"
  on public.cost_centers for select to authenticated using (true);

create policy "Owners/admins/finance can manage cost_centers"
  on public.cost_centers for all to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

-- Seed mínimo: 3 centros típicos de logística
insert into public.cost_centers (code, name, description) values
  ('FLOTA_DZ',    'Flota DZ',          'Vehículos y operación DZ Instalaciones.'),
  ('FLOTA_JOUVE', 'Flota Jouve',       'Vehículos y operación Jouve.'),
  ('ADMIN',       'Administración',    'Estructura común: oficinas, sueldos admin, etc.');

-- FK opcional en las tablas operacionales
alter table public.transactions      add column cost_center_id uuid references public.cost_centers (id) on delete set null;
alter table public.invoices          add column cost_center_id uuid references public.cost_centers (id) on delete set null;
alter table public.purchase_invoices add column cost_center_id uuid references public.cost_centers (id) on delete set null;
alter table public.payment_orders    add column cost_center_id uuid references public.cost_centers (id) on delete set null;
alter table public.receipts          add column cost_center_id uuid references public.cost_centers (id) on delete set null;
alter table public.journal_entries   add column cost_center_id uuid references public.cost_centers (id) on delete set null;

create index transactions_cost_center_idx       on public.transactions (cost_center_id)       where cost_center_id is not null;
create index invoices_cost_center_idx           on public.invoices (cost_center_id)           where cost_center_id is not null;
create index purchase_invoices_cost_center_idx  on public.purchase_invoices (cost_center_id)  where cost_center_id is not null;
create index payment_orders_cost_center_idx     on public.payment_orders (cost_center_id)     where cost_center_id is not null;
create index receipts_cost_center_idx           on public.receipts (cost_center_id)           where cost_center_id is not null;
create index journal_entries_cost_center_idx    on public.journal_entries (cost_center_id)    where cost_center_id is not null;

------------------------------------------------------------------------------
-- 4. L.8 — Ajuste por inflación
------------------------------------------------------------------------------
create table public.inflation_adjustments (
  id                  uuid         primary key default gen_random_uuid(),
  period              text         not null,
  coefficient         numeric(10,6) not null check (coefficient > 0),
  index_source        text,
  notes               text,
  journal_entry_id    uuid         references public.journal_entries (id) on delete set null,
  applied_at          timestamptz,
  applied_by          uuid         references auth.users (id) on delete set null,
  created_at          timestamptz  not null default now(),
  updated_at          timestamptz  not null default now(),
  constraint inflation_adjustments_period_format
    check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint inflation_adjustments_period_unique unique (period)
);

comment on table public.inflation_adjustments is
  'L.8 RG 4667 — coeficiente de ajuste por inflación mensual + asiento de reexpresión generado. UI completa permite aplicar / revertir.';

create index inflation_adjustments_period_idx on public.inflation_adjustments (period);

create trigger inflation_adjustments_set_updated_at
  before update on public.inflation_adjustments
  for each row execute function public.set_updated_at();

alter table public.inflation_adjustments enable row level security;

create policy "Authenticated can view inflation_adjustments"
  on public.inflation_adjustments for select to authenticated using (true);

create policy "Owners/admins/finance can manage inflation_adjustments"
  on public.inflation_adjustments for all to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

set row_security = on;
