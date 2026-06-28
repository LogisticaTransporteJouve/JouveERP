-- Link a shipment to the sales invoice issued for its freight ("facturar flete"),
-- so the carga shows as billed and double-billing is avoided.

alter table public.shipments
  add column invoice_id uuid references public.invoices (id) on delete set null;

create index shipments_invoice_idx on public.shipments (invoice_id);
