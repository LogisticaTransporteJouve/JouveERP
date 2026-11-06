SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Company-level accounting settings: one row (single CUIT). For now, the
-- month the fiscal year (ejercicio) starts in: Contabilidad › Balance takes
-- the Estado de Resultados from it when «Desde» is empty, and Resultado de
-- gestión and the assistant's EERR use it for «el ejercicio». The default is
-- October, the month the code assumed before this setting existed
-- (lib/fiscal-year.ts), so deploying it changes no figure.
--
-- Rollback: older code never reads this table (it hard-codes October).
create table public.accounting_settings (
  id                      boolean primary key default true check (id),
  fiscal_year_start_month smallint not null default 10
    check (fiscal_year_start_month between 1 and 12),
  updated_at              timestamptz not null default now(),
  updated_by              uuid references auth.users (id) on delete set null
);

comment on table public.accounting_settings is
  'Company-level accounting settings; a single row (id = true).';
comment on column public.accounting_settings.fiscal_year_start_month is
  'Month (1-12) the fiscal year starts in; a fiscal year is named by the calendar year it ends in.';

create index accounting_settings_updated_by_idx
  on public.accounting_settings (updated_by);

create trigger accounting_settings_set_updated_at
  before update on public.accounting_settings
  for each row execute function public.set_updated_at();

insert into public.accounting_settings (id) values (true);

alter table public.accounting_settings enable row level security;

-- Aligned with accounting:read in lib/auth/permissions.ts.
create policy "Accounting readers view accounting settings"
  on public.accounting_settings
  for select to authenticated
  using ( (select public.user_has_role(array['owner', 'admin', 'finance', 'fiscal_reader'])) );

-- Aligned with accounting:admin (owner and admin). The row is seeded here and
-- never inserted or deleted.
create policy "Owners and admins update accounting settings"
  on public.accounting_settings
  for update to authenticated
  using ( (select public.user_has_role(array['owner', 'admin'])) )
  with check ( (select public.user_has_role(array['owner', 'admin'])) );

revoke all on table public.accounting_settings from public, anon, authenticated;
grant select, update on table public.accounting_settings to authenticated;
grant all on table public.accounting_settings to service_role;
