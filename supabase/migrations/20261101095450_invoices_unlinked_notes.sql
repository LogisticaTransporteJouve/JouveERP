SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- NC/ND imported from ARCA that name no origin voucher. ARCA did not always
-- require CbtesAsoc (interest debits, general discounts, partial credits), so
-- the ERP cannot tie them to a factura; without this flag the import could
-- not store them and they never reached the client's account or the IVA book.
-- Only the ARCA import sets it; vouchers issued from the app still need their
-- origin (zod schema + this check).
alter table public.invoices
  add column origin_unlinked boolean not null default false;

comment on column public.invoices.origin_unlinked is
  'NC/ND imported from ARCA without a resolvable origin voucher.';

alter table public.invoices
  drop constraint invoices_nc_nd_requires_origen;

alter table public.invoices
  add constraint invoices_nc_nd_requires_origen
  check (kind = 'factura' or invoice_origin_id is not null or origin_unlinked)
  not valid;

alter table public.invoices
  validate constraint invoices_nc_nd_requires_origen;
