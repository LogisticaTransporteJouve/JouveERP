import {
  ComprobanteItemInputSchema,
  type ComprobanteItemInput,
} from "@/features/invoices/schema";
import type {
  PurchaseInvoiceDraftData,
  PurchaseInvoiceDraftItem,
  PurchaseInvoiceDraftSupplier,
} from "@/features/purchase-invoices/lib/purchase-invoice-draft";
import {
  PURCHASE_IVA_RATE_PERCENT,
  type PurchaseInvoiceKind,
  type PurchaseIvaRateId,
} from "@/features/purchase-invoices/schema";

import { InvoiceExtractionSchema, type InvoiceExtraction } from "./schemas";

/** Normalized AR alícuota (percent) → AFIP purchase iva_rate_id. */
const PERCENT_TO_RATE_ID: Record<number, PurchaseIvaRateId> = {
  0: 3,
  2.5: 9,
  5: 8,
  10.5: 4,
  21: 5,
  27: 6,
};

function alicuotaToRateId(value: unknown): PurchaseIvaRateId | null {
  return typeof value === "number" ? (PERCENT_TO_RATE_ID[value] ?? null) : null;
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(value: string | null | undefined): string | null {
  return value && ISO_DATE.test(value) ? value : null;
}

function positiveInt(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function amount(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? round(value, 2)
    : null;
}

/** Below this classification confidence the whole reading is flagged. */
const LOW_CONFIDENCE = 0.8;
/** Tolerance (pesos) before item sums vs header amounts are flagged. */
const AMOUNT_TOLERANCE = 0.05;

/**
 * Maps the extracted lines to the purchase form's items (quantity × unit price
 * + alícuota). All-or-nothing: if any line lacks a usable price or rate, the
 * draft keeps only the header totals.
 */
function draftItems(
  items: InvoiceExtraction["items"],
): PurchaseInvoiceDraftItem[] | null {
  const out: PurchaseInvoiceDraftItem[] = [];
  for (const item of items) {
    const description = item.description.trim();
    const quantity = item.quantity && item.quantity > 0 ? item.quantity : 1;
    const neto = item.net_amount ?? null;
    // The neto already carries any discount, so price = neto / qty keeps
    // quantity × price equal to the printed line.
    const unitPrice =
      neto !== null ? round(neto / quantity, 4) : (item.unit_price ?? null);
    const ivaAmount = item.iva_amount ?? null;
    const rateId =
      alicuotaToRateId(item.iva_rate) ??
      (ivaAmount !== null ? inferRateId(neto, ivaAmount) : null);
    if (
      !description ||
      unitPrice === null ||
      unitPrice < 0 ||
      rateId === null
    ) {
      return null;
    }
    out.push({
      description: description.slice(0, 500),
      quantity,
      unit_price: unitPrice,
      iva_rate_id: rateId,
    });
  }
  return out;
}

function itemsTotals(items: PurchaseInvoiceDraftItem[]): {
  neto: number;
  iva: number;
} {
  let neto = 0;
  let iva = 0;
  for (const it of items) {
    const lineNeto = round(it.quantity * it.unit_price, 2);
    const percent = it.iva_rate_id
      ? PURCHASE_IVA_RATE_PERCENT[it.iva_rate_id]
      : 0;
    neto += lineNeto;
    iva += round((lineNeto * percent) / 100, 2);
  }
  return { neto: round(neto, 2), iva: round(iva, 2) };
}

/**
 * Builds the editable purchase-invoice draft from an invoice extraction.
 * Fields the document did not show stay null (the user fills them); warnings
 * flag what deserves a second look. Returns null if the payload is not an
 * invoice extraction.
 */
export function buildPurchaseInvoiceDraft(
  payload: unknown,
  opts: {
    kind: PurchaseInvoiceKind;
    supplier: PurchaseInvoiceDraftSupplier | null;
    account: { id: string; label: string } | null;
    costCenterId: string | null;
    /** Exchange rate for a USD invoice's date, when one is loaded. */
    usdRate: number | null;
    confidence: number | null;
    duplicate: boolean;
  },
): PurchaseInvoiceDraftData | null {
  const parsed = InvoiceExtractionSchema.safeParse(payload);
  if (!parsed.success) return null;
  const inv = parsed.data;
  const warnings: string[] = [];

  if (opts.confidence !== null && opts.confidence < LOW_CONFIDENCE) {
    warnings.push(
      "La lectura tiene confianza baja: revisá todos los campos contra el archivo.",
    );
  }
  if (opts.duplicate) {
    warnings.push("Este comprobante parece estar ya cargado.");
  }

  const mapped = inv.items.length > 0 ? draftItems(inv.items) : [];
  const items = mapped ?? [];
  if (mapped === null) {
    warnings.push(
      "No se pudieron leer bien los ítems: se completaron solo los totales.",
    );
  }

  const neto = amount(inv.net_amount);
  const iva = amount(inv.iva_amount);
  const trib = amount(inv.other_taxes_amount);
  const total = amount(inv.total_amount);
  if (items.length > 0) {
    const sums = itemsTotals(items);
    if (neto !== null && Math.abs(sums.neto - neto) > AMOUNT_TOLERANCE) {
      warnings.push(
        "La suma de los ítems no coincide con el neto del comprobante.",
      );
    } else if (
      total !== null &&
      Math.abs(sums.neto + sums.iva + (trib ?? 0) - total) > AMOUNT_TOLERANCE
    ) {
      warnings.push(
        "Ítems + IVA + otros tributos no da el total del comprobante.",
      );
    }
  }

  const puntoVenta = positiveInt(inv.sales_point);
  const numero = positiveInt(inv.number);
  const fecha = isoDate(inv.date);
  const missing = [
    puntoVenta === null && "punto de venta",
    numero === null && "número",
    fecha === null && "fecha",
    total === null && "total",
  ].filter((m): m is string => typeof m === "string");
  if (missing.length > 0) {
    warnings.push(`No se encontró en el archivo: ${missing.join(", ")}.`);
  }

  const moneda = inv.currency === "USD" ? "DOL" : "PES";
  if (moneda === "DOL" && opts.usdRate === null) {
    warnings.push(
      "No hay cotización del dólar cargada para la fecha: completala.",
    );
  }

  const cae = inv.cae?.replace(/\D/g, "") ?? "";
  const counterparty = {
    legal_name: inv.counterparty_name?.trim() || null,
    cuit: inv.counterparty_cuit?.trim() || null,
  };

  return {
    supplier: opts.supplier,
    unmatchedSupplier:
      opts.supplier === null &&
      (counterparty.legal_name !== null || counterparty.cuit !== null)
        ? counterparty
        : null,
    kind: opts.kind,
    letter: inv.letter ?? null,
    punto_venta: puntoVenta,
    numero,
    fecha,
    fch_vto_pago: isoDate(inv.due_date),
    cae_proveedor: cae.length > 0 ? cae : null,
    cae_vto_proveedor: isoDate(inv.cae_due_date),
    imp_neto: neto,
    imp_iva: iva,
    imp_trib: trib,
    imp_total: total,
    moneda,
    cotizacion: moneda === "DOL" ? opts.usdRate : null,
    motivo_nc_nd: opts.kind === "factura" ? null : "Según documento escaneado",
    items,
    account: opts.account,
    cost_center_id: opts.costCenterId,
    warnings,
  };
}

/** Closest standard AR alícuota (±0.5 pp) for an implied iva/neto percent. */
function inferRateId(
  neto: number | null,
  iva: number | null,
): PurchaseIvaRateId | null {
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
        alicuotaToRateId(item.iva_rate) ??
        inferRateId(lineNeto, item.iva_amount ?? null),
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
