-- Audit remediation T2 — make invoice_items immutable once the parent invoice
-- is emitted or cancelled.
--
-- The header immutability trigger (20260509130000 / 20260517300000) covered only
-- `invoices`; `invoice_items` stayed UPDATE/DELETE-able by any finance role. Since
-- the fiscal PDF and the Libro IVA Ventas per-alicuota rows are regenerated from
-- the items, altering them post-CAE silently forges the served fiscal document
-- and corrupts the tax book. This blocks item mutation for emitted/cancelled
-- parents; drafts, emitting and failed invoices remain editable (re-draft flow).
--
-- Row-level trigger (NEW/OLD are assigned) — unlike the statement-level
-- purchase_invoice_items trigger, which is broken and fixed separately.

set row_security = off;

create or replace function public.guard_invoice_items_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_invoice_id uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  select status into v_status from public.invoices where id = v_invoice_id;
  if v_status in ('emitted', 'cancelled') then
    raise exception
      'No se pueden modificar los items de un comprobante emitido o anulado (estado %)', v_status
      using errcode = '55006';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists guard_invoice_items_immutable on public.invoice_items;
create trigger guard_invoice_items_immutable
  before update or delete on public.invoice_items
  for each row execute function public.guard_invoice_items_immutable();

set row_security = on;
