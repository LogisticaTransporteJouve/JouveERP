SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W14 · S5 F1: a draft left with no items holds its source.
--
-- issueFiscalInvoiceAction writes the header and its items in two requests.
-- When the process dies between them, or the items insert and its
-- compensating delete both fail, a header-only draft is left behind. Nothing
-- converged it: issue-invoice-reconcile resends only drafts with items, and
-- no screen fails or cancels a draft. Meanwhile it is the live document of
-- whatever it was billing:
-- - a remito interno billed in Ventas (invoices_source_remito_live_key and
--   guard_billed_remito_frozen read any draft as the remito's factura), so
--   the remito can no longer be billed, collected, credited or voided;
-- - a late-interest period (late_interest_charge_is_live reads the draft
--   keyed on the charge id), so the period reads charged with no ND;
-- - a carga or storage run linked to it (release_invoice_billing_links only
--   runs on failed or cancelled).
--
-- fail_itemless_invoice_drafts marks failed every draft older than the
-- cutoff that still has no items, in one statement, and returns their ids.
-- issue-invoice-reconcile calls it every 15 minutes with a 15-minute cutoff.
-- Every writer that inserts a draft with its items in one transaction
-- (settle_billed_remito, import_arca_issued_invoice) never leaves one
-- without items; issueFiscalInvoiceAction inserts the items within the same
-- request, well under the cutoff.
--
-- draft → failed fires, as for an emission AFIP rejects:
-- - invoices_release_billing_links: the cargas' link is cleared and the
--   storage runs are deleted;
-- - invoices_release_freight_settlement: a liquidación invoiced on it is
--   back to confirmed;
-- - invoices_release_late_interest: matches nd_invoice_id only, which is
--   set only after the ND's items exist; late_interest_charge_is_live
--   ignores a failed draft keyed on the charge, so the period is free again;
-- - invoices_guard_period_closed, check_invoice_immutability,
--   invoices_fiscal_cancel_guard, invoices_cancel_billed_remito_frozen and
--   invoices_cancel_blocked_if_allocated let it through (they guard draft,
--   emitting, emitted or cancelled); invoices_after_update_journal posts
--   nothing (a draft has no entry).
-- The unique index on source_remito_id and guard_billed_remito_frozen skip a
-- failed factura, so the remito is billable again.
--
-- Existing rows: production may hold such drafts. They are failed by the
-- first reconcile run after the promote; nothing is backfilled here. The
-- read-only control query is in docs/pendientes/antes-de-promover.md.
--
-- Rollback: older code does not call this function and keeps skipping the
-- drafts, as before.

create function public.fail_itemless_invoice_drafts(
  p_created_before timestamptz,
  p_limit integer default 50
)
returns setof uuid
language sql
volatile
security definer
set search_path = ''
as $$
  with picked as (
    select d.id
      from public.invoices d
     where d.status = 'draft'
       and d.created_at < p_created_before
       and not exists (
         select 1 from public.invoice_items it where it.invoice_id = d.id
       )
     order by d.created_at, d.id
     limit greatest(1, least(p_limit, 500))
     -- An items insert in flight holds the row (its foreign key check).
     for update skip locked
  )
  update public.invoices i
     set status = 'failed',
         afip_observaciones = jsonb_build_object(
           'error',
           'El comprobante quedó sin ítems (su carga se interrumpió) y se marcó fallido: volvé a emitirlo.'
         )
    from picked
   where i.id = picked.id
     and i.status = 'draft'
     and not exists (
       select 1 from public.invoice_items it where it.invoice_id = i.id
     )
  returning i.id;
$$;

comment on function public.fail_itemless_invoice_drafts(timestamptz, integer) is
  'Marca fallidos los borradores de comprobante sin ítems creados antes del corte (un alta interrumpida entre el encabezado y los ítems), lo que libera lo que facturaban. Devuelve sus ids. Solo service role (issue-invoice-reconcile).';

revoke all on function public.fail_itemless_invoice_drafts(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.fail_itemless_invoice_drafts(timestamptz, integer) to service_role;
