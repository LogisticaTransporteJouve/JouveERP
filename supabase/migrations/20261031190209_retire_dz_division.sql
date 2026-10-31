SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Retire the DZ Instalaciones division (docs/plan-separacion-fiscal-interno.md,
-- PR 0b, "camino borrar"): production has no DZ documents, so the channels go
-- away entirely and the app only operates Logística Jouve.
-- Aborts if any DZ document exists; only loose references (supplier defaults,
-- sales points, recurring payments, unbilled shipments) are cleared.
do $$
declare
  v_found text;
begin
  select string_agg(t || '=' || n, ', ') into v_found from (
              select 'invoices' t, count(*) n from public.invoices where channel_id in ('dz_fiscal', 'dz_internal')
    union all select 'purchase_invoices', count(*) from public.purchase_invoices where channel_id in ('dz_fiscal', 'dz_internal')
    union all select 'receipts', count(*) from public.receipts where channel_id in ('dz_fiscal', 'dz_internal')
    union all select 'payment_orders', count(*) from public.payment_orders where channel_id in ('dz_fiscal', 'dz_internal')
    union all select 'transactions', count(*) from public.transactions where channel_id in ('dz_fiscal', 'dz_internal')
    union all select 'journal_entries', count(*) from public.journal_entries where channel_id in ('dz_fiscal', 'dz_internal')
    union all select 'loans', count(*) from public.loans where channel_id in ('dz_fiscal', 'dz_internal')
    union all select 'payroll_payments', count(*) from public.payroll_payments where channel_id in ('dz_fiscal', 'dz_internal')
    union all select 'trips', count(*) from public.trips where channel_id in ('dz_fiscal', 'dz_internal')
    union all select 'checks', count(*) from public.checks where channel_id in ('dz_fiscal', 'dz_internal')
    union all select 'issued_checks', count(*) from public.issued_checks where channel_id in ('dz_fiscal', 'dz_internal')
    union all select 'shipments_billed', count(*) from public.shipments
               where channel_id in ('dz_fiscal', 'dz_internal') and invoice_id is not null
  ) x where n > 0;
  if v_found is not null then
    raise exception 'No se puede retirar DZ: hay documentos en sus canales (%)', v_found;
  end if;
end;
$$;

update public.suppliers set default_channel_id = null where default_channel_id in ('dz_fiscal', 'dz_internal');
update public.sales_points set channel_id = null, is_enabled = false where channel_id in ('dz_fiscal', 'dz_internal');
update public.recurring_payments set channel_id = null, is_active = false where channel_id in ('dz_fiscal', 'dz_internal');
update public.shipments set channel_id = null where channel_id in ('dz_fiscal', 'dz_internal');

delete from public.invoicing_channels where division = 'dz';

-- The column stays (expand-only: a rollback's code still reads it). The table
-- has two rows, so validating in the same transaction blocks nothing.
-- squawk-ignore ban-drop-constraint
alter table public.invoicing_channels drop constraint invoicing_channels_division_check;
alter table public.invoicing_channels
  add constraint invoicing_channels_division_check check (division = 'jouve') not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.invoicing_channels validate constraint invoicing_channels_division_check;

-- Owner-only diagnostic for the retirement; nothing in the app calls it.
-- squawk-ignore ban-drop-function
drop function if exists public.dz_open_items();
