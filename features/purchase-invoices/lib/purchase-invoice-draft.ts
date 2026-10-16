import type { z } from "zod";

import type { IvaCondition } from "@/features/clients/schema";

import type {
  PurchaseInvoiceCreateSchema,
  PurchaseInvoiceKind,
  PurchaseInvoiceLetter,
  PurchaseIvaRateId,
} from "../schema";

// A prefilled purchase invoice coming from outside the form (e.g. a scanned
// document). The form only knows this contract: whoever builds the draft also
// decides how it is saved (`submitCreate`).

export type PurchaseInvoiceCreateRawInput = z.input<
  typeof PurchaseInvoiceCreateSchema
>;

export type PurchaseInvoiceDraftSupplier = {
  id: string;
  legal_name: string;
  display_name: string | null;
  cuit: string;
  iva_condition: IvaCondition;
};

export type PurchaseInvoiceDraftItem = {
  description: string;
  quantity: number;
  unit_price: number;
  iva_rate_id: PurchaseIvaRateId | null;
};

/** Values read from the document; null = not found, left for the user. */
export type PurchaseInvoiceDraftData = {
  supplier: PurchaseInvoiceDraftSupplier | null;
  /** Counterparty as printed, when it did not match an existing supplier. */
  unmatchedSupplier: { legal_name: string | null; cuit: string | null } | null;
  kind: PurchaseInvoiceKind;
  /** False when the document did not print its type (kind is a default). */
  kind_read: boolean;
  letter: PurchaseInvoiceLetter | null;
  punto_venta: number | null;
  numero: number | null;
  fecha: string | null;
  fch_vto_pago: string | null;
  cae_proveedor: string | null;
  cae_vto_proveedor: string | null;
  imp_neto: number | null;
  imp_iva: number | null;
  imp_trib: number | null;
  imp_total: number | null;
  moneda: "PES" | "DOL";
  cotizacion: number | null;
  motivo_nc_nd: string | null;
  items: PurchaseInvoiceDraftItem[];
  /** Suggested expense account (posting), shown to the user before saving. */
  account: { id: string; label: string } | null;
  cost_center_id: string | null;
  warnings: string[];
};

export type PurchaseInvoiceDraftSource = {
  fileId: string;
  filename: string;
  mimeType: string | null;
};

export type PurchaseInvoiceDraft = {
  data: PurchaseInvoiceDraftData;
  source: PurchaseInvoiceDraftSource;
  submitCreate: (
    invoice: PurchaseInvoiceCreateRawInput,
  ) => Promise<{ id: string }>;
};

/** Form fields a draft can fill (and mark as filled from the document). */
export const DRAFT_FIELDS = [
  "supplier",
  "kind",
  "letter",
  "punto_venta",
  "numero",
  "fecha",
  "fch_vto_pago",
  "cae_proveedor",
  "cae_vto_proveedor",
  "imp_neto",
  "imp_iva",
  "imp_trib",
  "imp_total",
  "moneda",
  "cotizacion",
  "items",
] as const;
export type DraftField = (typeof DRAFT_FIELDS)[number];

/** Header amounts the form recomputes from the lines in item mode. */
export const ITEM_DERIVED_FIELDS: readonly DraftField[] = [
  "imp_neto",
  "imp_iva",
  "imp_total",
];

export type PurchaseInvoiceDraftPatch = {
  supplier: PurchaseInvoiceDraftSupplier | null;
  kind: PurchaseInvoiceKind;
  letter: PurchaseInvoiceLetter | "";
  punto_venta: string;
  numero: string;
  fecha: string;
  fch_vto_pago: string;
  cae_proveedor: string;
  cae_vto_proveedor: string;
  imp_neto: string;
  imp_iva: string;
  imp_trib: string;
  imp_total: string;
  moneda: string;
  cotizacion: string;
  motivo_nc_nd: string;
  with_items: boolean;
  items: {
    description: string;
    quantity: string;
    unit_price: string;
    iva_rate_id: PurchaseIvaRateId | null;
  }[];
};

function str(value: number | string | null, fallback: string): string {
  return value === null ? fallback : String(value);
}

/**
 * Maps a draft onto the form's string values. `filled` lists the fields that
 * came from the document, so the form can mark them; a field the document did
 * not have keeps the form's default and is not marked.
 */
export function draftToFormPatch(
  data: PurchaseInvoiceDraftData,
  defaults: { fecha: string },
): { patch: PurchaseInvoiceDraftPatch; filled: DraftField[] } {
  const filled: DraftField[] = [];
  const mark = (field: DraftField, present: boolean) => {
    if (present) filled.push(field);
  };

  mark("supplier", data.supplier !== null);
  mark("kind", data.kind_read);
  mark("letter", data.letter !== null);
  mark("punto_venta", data.punto_venta !== null);
  mark("numero", data.numero !== null);
  mark("fecha", data.fecha !== null);
  mark("fch_vto_pago", data.fch_vto_pago !== null);
  mark("cae_proveedor", data.cae_proveedor !== null);
  mark("cae_vto_proveedor", data.cae_vto_proveedor !== null);
  mark("imp_neto", data.imp_neto !== null);
  mark("imp_iva", data.imp_iva !== null);
  mark("imp_trib", data.imp_trib !== null);
  mark("imp_total", data.imp_total !== null);
  mark("moneda", true);
  mark("cotizacion", data.moneda === "DOL" && data.cotizacion !== null);
  mark("items", data.items.length > 0);

  return {
    patch: {
      supplier: data.supplier,
      kind: data.kind,
      letter: data.letter ?? "",
      punto_venta: str(data.punto_venta, ""),
      numero: str(data.numero, ""),
      fecha: data.fecha ?? defaults.fecha,
      fch_vto_pago: data.fch_vto_pago ?? "",
      cae_proveedor: data.cae_proveedor ?? "",
      cae_vto_proveedor: data.cae_vto_proveedor ?? "",
      imp_neto: str(data.imp_neto, "0"),
      imp_iva: str(data.imp_iva, "0"),
      imp_trib: str(data.imp_trib, "0"),
      imp_total: str(data.imp_total, ""),
      moneda: data.moneda,
      // A foreign-currency draft without a rate stays empty: the user types it.
      cotizacion: str(data.cotizacion, data.moneda === "PES" ? "1" : ""),
      motivo_nc_nd: data.motivo_nc_nd ?? "",
      with_items: data.items.length > 0,
      items: data.items.map((it) => ({
        description: it.description,
        quantity: String(it.quantity),
        unit_price: String(it.unit_price),
        iva_rate_id: it.iva_rate_id,
      })),
    },
    filled,
  };
}

/**
 * Header totals check: neto + IVA + otros tributos must equal the total (±1
 * cent). Returns the gap, or null when the amounts close or are incomplete.
 */
export function totalsGap(values: {
  imp_neto: string;
  imp_iva: string;
  imp_trib: string;
  imp_total: string;
}): number | null {
  const n = [
    values.imp_neto,
    values.imp_iva,
    values.imp_trib,
    values.imp_total,
  ].map((v) => (v === "" ? 0 : Number(v)));
  if (n.some((v) => !Number.isFinite(v))) return null;
  const [neto = 0, iva = 0, trib = 0, total = 0] = n;
  if (values.imp_total === "" || total === 0) return null;
  const gap = Math.round((total - (neto + iva + trib)) * 100) / 100;
  return Math.abs(gap) > 0.01 ? gap : null;
}

/**
 * Item mode: the total computed from the lines (+ otros tributos) against the
 * total printed on the document. Returns the gap, or null when they match or
 * the document had no total.
 */
export function documentTotalGap(
  documentTotal: number | null,
  computedTotal: number,
): number | null {
  if (documentTotal === null || !Number.isFinite(computedTotal)) return null;
  const gap = Math.round((documentTotal - computedTotal) * 100) / 100;
  return Math.abs(gap) > 0.01 ? gap : null;
}
