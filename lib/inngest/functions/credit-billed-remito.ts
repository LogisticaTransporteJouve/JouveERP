import { todayInAR } from "@/lib/format";
import { getServiceClient } from "@/lib/supabase/service";

import type { InvoiceIssueRequested } from "../events";

/**
 * Once a factura billed from a remito interno is emitted, passes the remito's
 * recibos internos to the fiscal side and drafts the nota de crédito interna
 * that credits the remito in full, so Otras ventas nets the
 * sale to zero and it exists only on the fiscal side (docs/otras-ventas.md §4).
 *
 * Idempotent: the NC's idempotency key is the factura's id, so a retried step
 * finds the draft it already wrote. Returns the event that issues the NC (the
 * internal branch of issue-invoice numbers it), or null when the factura has
 * no source remito.
 */
export async function creditBilledRemito(
  invoiceId: string,
): Promise<InvoiceIssueRequested | null> {
  const supabase = getServiceClient();

  const { data: factura, error: facturaErr } = await supabase
    .from("invoices")
    .select("id, letter, punto_venta, numero, source_remito_id, created_by")
    .eq("id", invoiceId)
    .maybeSingle();
  if (facturaErr) throw new Error(`load-factura: ${facturaErr.message}`);
  if (!factura?.source_remito_id) return null;

  // The remito's recibos internos pass to the fiscal side first, so the NC
  // below credits the remito's whole total.
  const { error: moveErr } = await supabase.rpc("move_billed_remito_receipts", {
    p_factura_id: factura.id,
  });
  if (moveErr) throw new Error(`move-receipts: ${moveErr.message}`);

  const { data: remito, error: remitoErr } = await supabase
    .from("invoices")
    .select(
      "id, channel_id, client_id, punto_venta, concepto, doc_tipo, doc_nro, moneda, cotizacion, imp_total",
    )
    .eq("id", factura.source_remito_id)
    .maybeSingle();
  if (remitoErr || !remito) {
    throw new Error(`load-remito: ${remitoErr?.message ?? "missing"}`);
  }

  const numero = `${factura.letter ?? ""}${String(factura.punto_venta).padStart(4, "0")}-${String(factura.numero ?? 0).padStart(8, "0")}`;
  const motivo = `Facturado como ${numero}`;
  const total = Number(remito.imp_total);
  const fecha = todayInAR();

  const { error: insertErr } = await supabase.from("invoices").upsert(
    {
      channel_id: remito.channel_id,
      client_id: remito.client_id,
      kind: "nc",
      letter: null,
      punto_venta: remito.punto_venta,
      fecha,
      concepto: remito.concepto,
      doc_tipo: remito.doc_tipo,
      doc_nro: remito.doc_nro,
      iva_condition_receptor: null,
      imp_neto: total,
      imp_iva: 0,
      imp_trib: 0,
      imp_tot_conc: 0,
      imp_op_ex: 0,
      imp_total: total,
      moneda: remito.moneda,
      cotizacion: remito.cotizacion,
      status: "draft",
      invoice_origin_id: remito.id,
      motivo_nc_nd: motivo,
      idempotency_key: factura.id,
      created_by: factura.created_by,
    },
    { onConflict: "idempotency_key", ignoreDuplicates: true },
  );
  if (insertErr) throw new Error(`insert-nc: ${insertErr.message}`);

  const { data: nc, error: ncErr } = await supabase
    .from("invoices")
    .select("id, status")
    .eq("idempotency_key", factura.id)
    .single();
  if (ncErr) throw new Error(`load-nc: ${ncErr.message}`);

  const { count, error: countErr } = await supabase
    .from("invoice_items")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", nc.id);
  if (countErr) throw new Error(`count-nc-items: ${countErr.message}`);
  if (!count) {
    const { error: itemErr } = await supabase.from("invoice_items").insert({
      invoice_id: nc.id,
      sort_order: 0,
      description: motivo,
      quantity: 1,
      unit_price: total,
      iva_rate_id: null,
      line_neto: total,
      line_iva: 0,
      line_total: total,
    });
    if (itemErr) throw new Error(`insert-nc-item: ${itemErr.message}`);
  }

  // Already issued by an earlier attempt: nothing left to send.
  if (nc.status !== "draft") return null;
  return {
    invoice_id: nc.id,
    idempotency_key: factura.id,
    channel_id: remito.channel_id,
    punto_venta: remito.punto_venta,
  };
}
