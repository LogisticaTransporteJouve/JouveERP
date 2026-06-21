import { PurchaseInvoiceItemSchema } from "@/features/purchase-invoices/schema";

import { InvoiceExtractionSchema } from "./schemas";

// Maps a reviewed invoice extraction to the input of the existing
// createPurchaseInvoiceAction. The header always maps; line items are
// best-effort — included only if EVERY line validates (otherwise the invoice
// is created header-only, like the AFIP-imported invoices). The create action
// re-validates everything, so a missing required field surfaces as its error.

/** Normalized AR alícuota (percent) → AFIP purchase iva_rate_id. */
const PERCENT_TO_RATE_ID: Record<number, number> = {
  0: 3,
  2.5: 9,
  5: 8,
  10.5: 4,
  21: 5,
  27: 6,
};

function alicuotaToRateId(value: unknown): number | null {
  return typeof value === "number" ? (PERCENT_TO_RATE_ID[value] ?? null) : null;
}

export type PurchaseInvoiceFromExtraction = {
  channel_id: string;
  supplier_id: string;
  kind: "factura";
  letter: string | null;
  punto_venta: number;
  numero: number;
  fecha: string;
  fch_vto_pago: string | null;
  imp_neto: number;
  imp_iva: number;
  imp_trib: number;
  imp_total: number;
  moneda: string;
  cotizacion: number;
  items: unknown[];
};

/**
 * Builds the createPurchaseInvoiceAction input from an invoice extraction
 * payload. Returns null if the payload isn't a parseable invoice extraction.
 */
export function buildPurchaseInvoiceInput(
  payload: unknown,
  opts: { channelId: string; supplierId: string },
): PurchaseInvoiceFromExtraction | null {
  const parsed = InvoiceExtractionSchema.safeParse(payload);
  if (!parsed.success) return null;
  const inv = parsed.data;

  const mapped = inv.items.map((item) => {
    const quantity = item.cantidad && item.cantidad > 0 ? item.cantidad : 1;
    const lineNeto = item.importe_neto ?? null;
    const unitPrice =
      item.precio_unitario ?? (lineNeto !== null ? lineNeto / quantity : null);
    return {
      description: item.descripcion,
      quantity,
      unit_price: unitPrice,
      iva_rate_id: alicuotaToRateId(item.alicuota_iva),
      line_neto: lineNeto,
      line_iva: item.importe_iva ?? 0,
      line_total: item.importe_total ?? null,
      sort_order: 0,
    };
  });

  const validItems: unknown[] = [];
  let allValid = mapped.length > 0;
  for (const candidate of mapped) {
    const result = PurchaseInvoiceItemSchema.safeParse(candidate);
    if (result.success) {
      validItems.push(result.data);
    } else {
      allValid = false;
      break;
    }
  }

  return {
    channel_id: opts.channelId,
    supplier_id: opts.supplierId,
    kind: "factura",
    letter: inv.letra ?? null,
    punto_venta: inv.punto_venta ?? 0,
    numero: inv.numero ?? 0,
    fecha: inv.fecha ?? "",
    fch_vto_pago: inv.fch_vto_pago ?? null,
    imp_neto: inv.importe_neto ?? 0,
    imp_iva: inv.importe_iva ?? 0,
    imp_trib: inv.importe_trib ?? 0,
    imp_total: inv.importe_total ?? 0,
    moneda: inv.moneda === "USD" ? "DOL" : "PES",
    cotizacion: 1,
    items: allValid ? validItems : [],
  };
}
