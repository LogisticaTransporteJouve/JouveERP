SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- issueComprobante (lib/commands/issue-comprobante.ts, behind
-- issueFiscalInvoiceAction and the assistant's proposals) inserted the draft
-- header and then its items in two requests, deleting the header when the
-- items failed. When that delete failed too, or the process died between the
-- two, a header-only draft was left: it holds what it was billing until
-- fail_itemless_invoice_drafts fails it, and a resubmit with the same
-- idempotency key found it and sent it to issue-invoice.
--
-- create_invoice_draft inserts the header and its items in one transaction:
-- when an item is refused nothing is saved. The caller keeps every check it
-- made before (channel, client, punto de venta, origin, AFIP rules, NC open
-- amount) and builds the same row; status is always 'draft' and numero always
-- null here (issue-invoice reserves the number). The triggers on invoices and
-- invoice_items fire as for the two inserts, so a guard's refusal (hint
-- jouve_guard) and a repeated idempotency_key (23505 on its unique index)
-- reach the caller with the same code and message as before.
--
-- SECURITY INVOKER: only the service role calls it, as it made the inserts.
--
-- fail_itemless_invoice_drafts stays: it converges the header-only drafts
-- already in the table and any an older build writes after a code rollback.
--
-- Existing rows: none touched. Rollback: older code does not call this
-- function; dropping it is safe.

create function public.create_invoice_draft(p_invoice jsonb, p_items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_invoice is null or jsonb_typeof(p_invoice) <> 'object' then
    raise exception 'p_invoice must be a json object' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a draft needs at least one item' using errcode = '22023';
  end if;

  insert into public.invoices (
    channel_id, client_id, kind, letter, cbte_tipo_afip, punto_venta, numero,
    fecha, fch_serv_desde, fch_serv_hasta, fch_vto_pago, concepto, doc_tipo,
    doc_nro, iva_condition_receptor, imp_neto, imp_iva, imp_trib, imp_tot_conc,
    imp_op_ex, imp_total, moneda, cotizacion, status, invoice_origin_id,
    source_remito_id, motivo_nc_nd, notes, idempotency_key, created_by
  )
  select
    r.channel_id, r.client_id, r.kind, r.letter, r.cbte_tipo_afip, r.punto_venta, null,
    r.fecha, r.fch_serv_desde, r.fch_serv_hasta, r.fch_vto_pago, r.concepto, r.doc_tipo,
    r.doc_nro, r.iva_condition_receptor, r.imp_neto, r.imp_iva, r.imp_trib, r.imp_tot_conc,
    r.imp_op_ex, r.imp_total, r.moneda, r.cotizacion, 'draft', r.invoice_origin_id,
    r.source_remito_id, r.motivo_nc_nd, r.notes, r.idempotency_key, r.created_by
  from jsonb_populate_record(null::public.invoices, p_invoice) r
  returning id into v_id;

  insert into public.invoice_items (
    invoice_id, sort_order, description, quantity, unit_price, iva_rate_id,
    revenue_kind, line_neto, line_iva, line_total
  )
  select
    v_id, i.sort_order, i.description, i.quantity, i.unit_price, i.iva_rate_id,
    coalesce(i.revenue_kind, 'service'), i.line_neto, i.line_iva, i.line_total
  from jsonb_populate_recordset(null::public.invoice_items, p_items) i;

  return v_id;
end;
$$;

comment on function public.create_invoice_draft(jsonb, jsonb) is
  'issueComprobante: inserts a comprobante draft and its items in one transaction. Returns the new invoice id.';

revoke all on function public.create_invoice_draft(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_invoice_draft(jsonb, jsonb) to service_role;
