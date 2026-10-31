SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Audit 2026-10-31, Módulos S8: fuel loads and maintenance records had no link
-- to the purchase invoice or the treasury movement that books them, so a fleet
-- cost could not be traced to accounting. Optional links, expand-only: both
-- nullable, RLS unchanged. A cost with neither is "sin comprobante" in the
-- fleet report. ON DELETE SET NULL: deleting the voucher leaves the cost
-- unlinked, never deletes it.

-- The columns are new and all NULL: the FK check has no row to scan, so the
-- lock is momentary. No index: these tables are small and the report reads
-- them by date.
alter table public.fuel_loads
  -- squawk-ignore adding-foreign-key-constraint
  add column purchase_invoice_id uuid references public.purchase_invoices (id) on delete set null,
  -- squawk-ignore adding-foreign-key-constraint
  add column transaction_id uuid references public.transactions (id) on delete set null;

alter table public.maintenance_records
  -- squawk-ignore adding-foreign-key-constraint
  add column purchase_invoice_id uuid references public.purchase_invoices (id) on delete set null,
  -- squawk-ignore adding-foreign-key-constraint
  add column transaction_id uuid references public.transactions (id) on delete set null;

comment on column public.fuel_loads.purchase_invoice_id is
  'Purchase invoice that books this load (optional).';
comment on column public.fuel_loads.transaction_id is
  'Treasury movement that pays this load (optional).';
comment on column public.maintenance_records.purchase_invoice_id is
  'Purchase invoice that books this service (optional).';
comment on column public.maintenance_records.transaction_id is
  'Treasury movement that pays this service (optional).';
