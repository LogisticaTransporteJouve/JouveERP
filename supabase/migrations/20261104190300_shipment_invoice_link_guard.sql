SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W11 · S5 F1: a carga links only a live invoice of its client.
--
-- invoiceFreightAction links the carga's invoice with a plain update after
-- the issue (or after finding the invoice an earlier click issued). An
-- invoice that failed in between (an AFIP rejection, or the reconcile cron
-- marking a stuck emission failed) had already run
-- release_invoice_billing_links, which found no carga to free; the link then
-- wrote the void invoice and the carga read billed for good: it could not be
-- invoiced again, edited or deleted. The storage peer refuses such a link
-- (guard_storage_billing_run_invoice, 20261104160002), and so does
-- link_freight_settlement_invoice (20261103090000).
--
-- guard_shipment_invoice (before insert or update of invoice_id): a carga
-- links only an invoice of its client that has not failed or been cancelled.
-- The invoice row is locked (for share), so a failure recorded at the same
-- time either runs first (and the link is refused) or after (and
-- release_invoice_billing_links frees the carga). Clearing the link passes.
--
-- The writers of shipments.invoice_id, latest definitions:
-- - invoiceFreightAction: links its carga's invoice (same client, checked by
--   the action); on a refusal it now frees the carga's claim;
-- - link_freight_settlement_invoice (20261103090000): links the grouped
--   invoice after locking it for update and refusing a void one or another
--   client's; the liquidación's cargas are its client's
--   (guard_freight_settlement_item);
-- - release_invoice_billing_links (20261016100000), cancel_freight_settlement
--   (20261103090000) and the FK's set null on an invoice delete: clear it.
-- No seed, importer or other SQL writes it.
--
-- Existing rows are not touched. Rollback: older code links the same way; a
-- refused link reads as «no se vinculó» and keeps the claim, which expires in
-- 15 minutes, and the next «Facturar flete» issues under the next key (the
-- void invoice's key is skipped).

create function public.guard_shipment_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid;
  v_status    text;
begin
  if new.invoice_id is null
     or (tg_op = 'UPDATE' and new.invoice_id is not distinct from old.invoice_id) then
    return new;
  end if;

  select i.client_id, i.status::text
    into v_client_id, v_status
    from public.invoices i
   where i.id = new.invoice_id
     for share;
  if not found then
    -- The foreign key refuses it.
    return new;
  end if;
  if v_client_id is distinct from new.client_id then
    raise exception 'La factura no es del cliente de la carga.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_status in ('failed', 'cancelled') then
    raise exception 'La factura del flete falló o se anuló: volvé a facturar la carga.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_shipment_invoice() from public, anon, authenticated;

create trigger shipments_guard_invoice
  before insert or update of invoice_id on public.shipments
  for each row execute function public.guard_shipment_invoice();
