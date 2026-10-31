SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Audit 2026-10-31, Módulos S8: fuel loads and maintenance records had no link
-- to the purchase invoice or the treasury movement that books them, so a fleet
-- cost could not be traced to accounting. Optional links, expand-only: both
-- nullable, RLS unchanged. A cost with neither is "sin comprobante" in the
-- fleet report. ON DELETE SET NULL: deleting the voucher leaves the cost
-- unlinked, never deletes it.

alter table public.fuel_loads
  add column purchase_invoice_id uuid,
  add column transaction_id uuid;

alter table public.fuel_loads
  add constraint fuel_loads_purchase_invoice_id_fkey
    foreign key (purchase_invoice_id) references public.purchase_invoices (id)
    on delete set null not valid;
alter table public.fuel_loads
  validate constraint fuel_loads_purchase_invoice_id_fkey;

alter table public.fuel_loads
  add constraint fuel_loads_transaction_id_fkey
    foreign key (transaction_id) references public.transactions (id)
    on delete set null not valid;
alter table public.fuel_loads
  validate constraint fuel_loads_transaction_id_fkey;

alter table public.maintenance_records
  add column purchase_invoice_id uuid,
  add column transaction_id uuid;

alter table public.maintenance_records
  add constraint maintenance_records_purchase_invoice_id_fkey
    foreign key (purchase_invoice_id) references public.purchase_invoices (id)
    on delete set null not valid;
alter table public.maintenance_records
  validate constraint maintenance_records_purchase_invoice_id_fkey;

alter table public.maintenance_records
  add constraint maintenance_records_transaction_id_fkey
    foreign key (transaction_id) references public.transactions (id)
    on delete set null not valid;
alter table public.maintenance_records
  validate constraint maintenance_records_transaction_id_fkey;

comment on column public.fuel_loads.purchase_invoice_id is
  'Purchase invoice that books this load (optional).';
comment on column public.fuel_loads.transaction_id is
  'Treasury movement that pays this load (optional).';
comment on column public.maintenance_records.purchase_invoice_id is
  'Purchase invoice that books this service (optional).';
comment on column public.maintenance_records.transaction_id is
  'Treasury movement that pays this service (optional).';
