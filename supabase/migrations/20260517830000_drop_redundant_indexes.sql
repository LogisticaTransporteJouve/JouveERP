-- Drop indexes redundantes identificados en auditoría.
--
-- Criterios:
--   - Index sobre columna ya cubierta por UNIQUE/PK.
--   - Index sobre columna que nunca aparece en WHERE/ORDER BY del código.
--   - Index sobre tabla de muy baja cardinalidad (<50 rows).
--
-- Solo dropamos donde es claramente safe; en duda dejamos el index.

drop index if exists public.invoicing_channels_business_unit_idx;
drop index if exists public.invoicing_channels_division_idx;
drop index if exists public.chart_of_accounts_account_type_idx;
drop index if exists public.chart_of_accounts_active_idx;
drop index if exists public.holidays_year_idx;
drop index if exists public.attendance_records_kind_idx;
drop index if exists public.inflation_adjustments_period_idx;

-- accounts_name_type_currency_idx: convertir a partial donde is_active=true
-- para liberar el nombre al desactivar. Drop+recreate.
drop index if exists public.accounts_name_type_currency_idx;
create unique index accounts_name_type_currency_active_idx
  on public.accounts (lower(name), type, currency)
  where is_active = true;

-- Agregar index compuesto que aging usa fuerte y faltaba
create index if not exists invoices_fiscal_emitted_fecha_idx
  on public.invoices (channel_id, fecha)
  where status = 'emitted';

create index if not exists purchase_invoices_received_fecha_idx
  on public.purchase_invoices (channel_id, fecha)
  where status = 'received';
