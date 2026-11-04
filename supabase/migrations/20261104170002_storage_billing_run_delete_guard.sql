SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W10 · S2 F3: a billed storage period is not freed by deleting its
-- run.
--
-- RLS lets owner, admin and finance DELETE storage_billing_runs, and no
-- trigger looked at a delete. A direct DELETE of a run linked to an emitted
-- invoice freed its days, and the next «Facturar» issued a second factura
-- with its own CAE. The freight peer refuses it (shipments_guard_billed,
-- 20261031200412).
--
-- The writers that delete runs, latest definitions:
-- - claim_storage_billing_period (20261104160002): a stale pending run with
--   no live invoice, with its items, issued under the run's id;
-- - invoiceStorageAction: its own pending run (invoice_id is null) when the
--   issue fails, or when the link finds the invoice failed or cancelled;
-- - release_invoice_billing_links (20261016100000): the runs linked to an
--   invoice that just failed or was cancelled. It runs after that status
--   update, so the invoice already reads failed or cancelled.
-- No foreign key deletes a run (client_id is on delete restrict; an invoice
-- delete sets invoice_id null), and no seed or importer deletes one.
--
-- guard_storage_billing_run_delete (before delete): a run is not deleted
-- while its invoice is live (not failed or cancelled). For a pending run
-- that is the invoice linked to it, or, with no link, a live invoice with
-- its items issued under the run's id (the one the claim would relink).
-- Every writer above deletes only runs that pass.
--
-- Existing rows are not touched. Rollback: older code deletes runs through
-- the same paths.

create function public.guard_storage_billing_run_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.invoice_id is not null
      and exists (select 1 from public.invoices i
                   where i.id = old.invoice_id
                     and i.status not in ('failed', 'cancelled')))
     or (old.invoice_id is null
         and exists (select 1 from public.invoices i
                      where i.idempotency_key = old.id::text
                        and i.status not in ('failed', 'cancelled')
                        and exists (select 1 from public.invoice_items it
                                     where it.invoice_id = i.id))) then
    raise exception 'El período de almacenaje tiene una factura vigente: anulala (o emití la nota de crédito) para liberarlo.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return old;
end;
$$;

revoke all on function public.guard_storage_billing_run_delete() from public, anon, authenticated;

create trigger storage_billing_runs_guard_delete
  before delete on public.storage_billing_runs
  for each row execute function public.guard_storage_billing_run_delete();
