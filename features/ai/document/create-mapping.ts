import {
  ComprobanteItemInputSchema,
  type ComprobanteItemInput,
} from "@/features/invoices/schema";
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
  account_id: string | null;
  cost_center_id: string | null;
  kind: "factura" | "nc" | "nd";
  motivo_nc_nd: string | null;
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
  opts: {
    channelId: string;
    supplierId: string;
    accountId?: string | null;
    costCenterId?: string | null;
    /** "factura" (default) or "nc"/"nd" for a scanned credit_debit_note. */
    kind?: "factura" | "nc" | "nd";
    motivo?: string | null;
  },
): PurchaseInvoiceFromExtraction | null {
  const parsed = InvoiceExtractionSchema.safeParse(payload);
  if (!parsed.success) return null;
  const inv = parsed.data;

  const mapped = inv.items.map((item) => {
    const quantity = item.quantity && item.quantity > 0 ? item.quantity : 1;
    const lineNeto = item.net_amount ?? null;
    const unitPrice =
      item.unit_price ?? (lineNeto !== null ? lineNeto / quantity : null);
    return {
      description: item.description,
      quantity,
      unit_price: unitPrice,
      iva_rate_id: alicuotaToRateId(item.iva_rate),
      line_neto: lineNeto,
      line_iva: item.iva_amount ?? 0,
      line_total: item.total_amount ?? null,
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
    account_id: opts.accountId ?? null,
    cost_center_id: opts.costCenterId ?? null,
    kind: opts.kind ?? "factura",
    motivo_nc_nd: opts.motivo ?? null,
    letter: inv.letter ?? null,
    punto_venta: inv.sales_point ?? 0,
    numero: inv.number ?? 0,
    fecha: inv.date ?? "",
    fch_vto_pago: inv.due_date ?? null,
    imp_neto: inv.net_amount ?? 0,
    imp_iva: inv.iva_amount ?? 0,
    imp_trib: inv.other_taxes_amount ?? 0,
    imp_total: inv.total_amount ?? 0,
    moneda: inv.currency === "USD" ? "DOL" : "PES",
    cotizacion: 1,
    items: allValid ? validItems : [],
  };
}

/** Closest standard AR alícuota (±0.5 pp) for an implied iva/neto percent. */
function inferRateId(neto: number | null, iva: number | null): number | null {
  if (iva === null || iva === 0) return PERCENT_TO_RATE_ID[0] ?? null;
  if (!neto || neto <= 0) return null;
  const pct = (iva / neto) * 100;
  for (const [percent, id] of Object.entries(PERCENT_TO_RATE_ID)) {
    if (Math.abs(pct - Number(percent)) <= 0.5) return id;
  }
  return null;
}

export type SalesInvoiceItemsFromExtraction = {
  items: ComprobanteItemInput[];
  /** True when items didn't map and a single header-derived line was used. */
  fallback: boolean;
};

/**
 * Maps extraction items to `issueFiscalInvoiceAction` items. Unlike purchases
 * (where items are optional), a comprobante needs >= 1 item, so when the
 * extracted lines don't validate we fall back to a single line built from the
 * header amounts. Returns null only if not even the header has an amount.
 */
export function buildSalesInvoiceItems(
  payload: unknown,
): SalesInvoiceItemsFromExtraction | null {
  const parsed = InvoiceExtractionSchema.safeParse(payload);
  if (!parsed.success) return null;
  const inv = parsed.data;

  const candidates = inv.items.map((item) => {
    const quantity = item.quantity && item.quantity > 0 ? item.quantity : 1;
    const lineNeto = item.net_amount ?? null;
    const unitPrice =
      item.unit_price ?? (lineNeto !== null ? lineNeto / quantity : null);
    return {
      description: item.description,
      quantity,
      unit_price: unitPrice,
      iva_rate_id:
        alicuotaToRateId(item.iva_rate) ?? inferRateId(lineNeto, item.iva_amount ?? null),
    };
  });

  const valid: SalesInvoiceItemsFromExtraction["items"] = [];
  let allValid = candidates.length > 0;
  for (const candidate of candidates) {
    const result = ComprobanteItemInputSchema.safeParse(candidate);
    if (result.success) {
      valid.push(result.data);
    } else {
      allValid = false;
      break;
    }
  }
  if (allValid) return { items: valid, fallback: false };

  const neto =
    inv.net_amount ??
    (inv.total_amount !== null && inv.total_amount !== undefined
      ? inv.total_amount - (inv.iva_amount ?? 0) - (inv.other_taxes_amount ?? 0)
      : null);
  if (neto === null || neto <= 0) return null;
  const single = ComprobanteItemInputSchema.safeParse({
    description: "Según comprobante escaneado",
    quantity: 1,
    unit_price: neto,
    iva_rate_id: inferRateId(neto, inv.iva_amount ?? null),
  });
  if (!single.success) return null;
  return { items: [single.data], fallback: true };
}
