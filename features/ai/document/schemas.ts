import { z } from "zod";

import { DOCUMENT_KINDS } from "./types";

// Extraction schemas are intentionally lenient: every field the document might
// not print is nullable, so the model returns null instead of hallucinating and
// the deterministic post-inference (post-inference.ts) fills the gaps. Narrow
// schema per type = less hallucination (docs/ai-overview.md §5-bis).
//
// generateObject runs with structuredOutputMode='jsonTool' (engine.ts), so the
// schemas are sent as a tool input_schema rather than Anthropic's constrained
// grammar — there is no 16-union-parameter ceiling and no grammar-compile cost.

/** Stage 1 — classification (generic-tray mode). */
export const ClassificationSchema = z.object({
  type: z.enum(DOCUMENT_KINDS),
  confidence: z.number().min(0).max(1),
  currency: z.enum(["ARS", "USD"]).nullish(),
  hints: z.string().nullish(),
});
export type Classification = z.infer<typeof ClassificationSchema>;

/** A party as printed on the document (issuer / recipient). */
export const PartySchema = z.object({
  name: z.string().nullish(),
  cuit: z.string().nullish(),
  iva_condition: z.string().nullish(),
  address: z.string().nullish(),
  city: z.string().nullish(),
  province: z.string().nullish(),
});
export type Party = z.infer<typeof PartySchema>;

/** Payment details printed on an invoice. */
export const PaymentSchema = z.object({
  method: z.string().nullish(),
  cbu: z.string().nullish(),
  alias: z.string().nullish(),
  bank: z.string().nullish(),
});
export type Payment = z.infer<typeof PaymentSchema>;

/** One invoice line. `iva_rate` is loose (number/string) — normalized later. */
export const ExtractedItemSchema = z.object({
  description: z.string(),
  quantity: z.number().nullish(),
  unit: z.string().nullish(),
  unit_price: z.number().nullish(),
  discount_pct: z.number().nullish(),
  net_amount: z.number().nullish(),
  iva_rate: z.union([z.number(), z.string()]).nullish(),
  iva_amount: z.number().nullish(),
  total_amount: z.number().nullish(),
});
export type ExtractedItem = z.infer<typeof ExtractedItemSchema>;

/**
 * factura_compra / factura_venta / nc_nd. Header and items are split into two
 * schemas and extracted in two calls (engine.ts) — historically to dodge the
 * union-parameter ceiling, kept because it also keeps each call focused.
 * `counterparty_*` (flat) stays the canonical counterparty for matching/mapping;
 * `issuer`/`recipient`/`payment` are additive richer fields for the preview.
 */
export const InvoiceHeaderSchema = z.object({
  counterparty_name: z.string().nullish(),
  counterparty_cuit: z.string().nullish(),
  issuer: PartySchema.nullish(),
  recipient: PartySchema.nullish(),
  payment: PaymentSchema.nullish(),
  sales_point: z.number().nullish(),
  number: z.number().nullish(),
  letter: z.enum(["A", "B", "C"]).nullish(),
  date: z.string().nullish(),
  payment_terms: z.string().nullish(),
  due_date: z.string().nullish(),
  currency: z.enum(["ARS", "USD"]).nullish(),
  net_amount: z.number().nullish(),
  iva_amount: z.number().nullish(),
  other_taxes_amount: z.number().nullish(),
  total_amount: z.number().nullish(),
});

export const InvoiceItemsSchema = z.object({
  items: z.array(ExtractedItemSchema).default([]),
});

export const InvoiceExtractionSchema = InvoiceHeaderSchema.extend({
  items: z.array(ExtractedItemSchema).default([]),
});
export type InvoiceExtraction = z.infer<typeof InvoiceExtractionSchema>;

/** recibo. */
export const ReceiptExtractionSchema = z.object({
  counterparty_name: z.string().nullish(),
  counterparty_cuit: z.string().nullish(),
  number: z.number().nullish(),
  date: z.string().nullish(),
  currency: z.enum(["ARS", "USD"]).nullish(),
  total_amount: z.number().nullish(),
});
export type ReceiptExtraction = z.infer<typeof ReceiptExtractionSchema>;

/** orden_pago. */
export const PaymentOrderExtractionSchema = z.object({
  counterparty_name: z.string().nullish(),
  counterparty_cuit: z.string().nullish(),
  number: z.number().nullish(),
  date: z.string().nullish(),
  currency: z.enum(["ARS", "USD"]).nullish(),
  total_amount: z.number().nullish(),
});
export type PaymentOrderExtraction = z.infer<
  typeof PaymentOrderExtractionSchema
>;

/** One remito line — goods moved, no amounts. */
export const RemitoItemSchema = z.object({
  description: z.string(),
  code: z.string().nullish(),
  afip_code: z.string().nullish(),
  quantity: z.number().nullish(),
  unit: z.string().nullish(),
  units: z.number().nullish(),
  packaging_type: z.string().nullish(),
});
export type RemitoItem = z.infer<typeof RemitoItemSchema>;

/** remito — a delivery note: products + quantities, no prices. */
export const RemitoExtractionSchema = z.object({
  counterparty_name: z.string().nullish(),
  counterparty_cuit: z.string().nullish(),
  sales_point: z.number().nullish(),
  number: z.number().nullish(),
  date: z.string().nullish(),
  delivery_date: z.string().nullish(),
  destination: z.string().nullish(),
  carrier: z.string().nullish(),
  driver: z.string().nullish(),
  vehicle_plate: z.string().nullish(),
  total_kilos: z.number().nullish(),
  cre: z.string().nullish(),
  observations: z.string().nullish(),
  items: z.array(RemitoItemSchema).default([]),
});
export type RemitoExtraction = z.infer<typeof RemitoExtractionSchema>;

/** cheque. */
export const ChequeExtractionSchema = z.object({
  bank: z.string().nullish(),
  series: z.string().nullish(),
  number: z.string().nullish(),
  date: z.string().nullish(), // emisión
  payment_date: z.string().nullish(), // pago / vencimiento (diferido / CPD)
  amount: z.number().nullish(),
  beneficiary: z.string().nullish(),
  drawer: z.string().nullish(), // titular de la cuenta que libra el cheque
  drawer_cuit: z.string().nullish(),
  account: z.string().nullish(), // nº de cuenta
  currency: z.enum(["ARS", "USD"]).nullish(),
  type: z.enum(["propio", "tercero", "diferido"]).nullish(),
});
export type ChequeExtraction = z.infer<typeof ChequeExtractionSchema>;

/** A photo may contain one or several checks — extract them all. */
export const ChequeBatchExtractionSchema = z.object({
  cheques: z.array(ChequeExtractionSchema).default([]),
});
export type ChequeBatchExtraction = z.infer<typeof ChequeBatchExtractionSchema>;

/** One bank-statement movement. */
export const ExtractoMovimientoSchema = z.object({
  date: z.string().nullish(),
  concept: z.string(),
  debit: z.number().nullish(),
  credit: z.number().nullish(),
  balance: z.number().nullish(),
});
export type ExtractoMovimiento = z.infer<typeof ExtractoMovimientoSchema>;

/** extracto bancario. */
export const ExtractoBancarioExtractionSchema = z.object({
  bank: z.string().nullish(),
  account: z.string().nullish(),
  period: z.string().nullish(),
  opening_balance: z.number().nullish(),
  closing_balance: z.number().nullish(),
  currency: z.enum(["ARS", "USD"]).nullish(),
  movements: z.array(ExtractoMovimientoSchema).default([]),
});
export type ExtractoBancarioExtraction = z.infer<
  typeof ExtractoBancarioExtractionSchema
>;

/**
 * Extraction schema per document kind. Only `otro` stays classification-only
 * (no structured shape). Each kind drives both extraction and the per-type
 * detail renderer (components/detail/*).
 */
export const EXTRACTION_SCHEMAS = {
  factura_compra: InvoiceExtractionSchema,
  factura_venta: InvoiceExtractionSchema,
  nc_nd: InvoiceExtractionSchema,
  recibo: ReceiptExtractionSchema,
  orden_pago: PaymentOrderExtractionSchema,
  remito: RemitoExtractionSchema,
  cheque: ChequeBatchExtractionSchema,
  extracto: ExtractoBancarioExtractionSchema,
} as const;

export type ExtractableKind = keyof typeof EXTRACTION_SCHEMAS;

export function isExtractableKind(kind: string): kind is ExtractableKind {
  return kind in EXTRACTION_SCHEMAS;
}
