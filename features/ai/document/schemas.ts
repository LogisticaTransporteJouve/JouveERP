import { z } from "zod";

import { DOCUMENT_KINDS } from "./types";

// Extraction schemas are intentionally lenient: every field the document might
// not print is nullable, so the model returns null instead of hallucinating and
// the deterministic post-inference (post-inference.ts) fills the gaps. Narrow
// schema per type = less hallucination (docs/ai-overview.md §5-bis).

/** Stage 1 — classification (generic-tray mode). */
export const ClassificationSchema = z.object({
  tipo: z.enum(DOCUMENT_KINDS),
  confianza: z.number().min(0).max(1),
  moneda: z.enum(["ARS", "USD"]).nullish(),
  pistas: z.string().nullish(),
});
export type Classification = z.infer<typeof ClassificationSchema>;

/** One invoice line. `alicuota_iva` is loose (number/string) — normalized later. */
export const ExtractedItemSchema = z.object({
  descripcion: z.string(),
  cantidad: z.number().nullish(),
  unidad: z.string().nullish(),
  precio_unitario: z.number().nullish(),
  bonif_pct: z.number().nullish(),
  importe_neto: z.number().nullish(),
  alicuota_iva: z.union([z.number(), z.string()]).nullish(),
  importe_iva: z.number().nullish(),
  importe_total: z.number().nullish(),
});
export type ExtractedItem = z.infer<typeof ExtractedItemSchema>;

/**
 * factura_compra / factura_venta / nc_nd. Header and items are split into two
 * schemas so each generateObject call stays under Anthropic's limit of 16
 * union-typed parameters — the combined invoice has 21 nullable/union fields
 * (13 header + 8 per-item), which the API rejects. The engine extracts header
 * and items in two calls and merges them (see engine.ts).
 */
export const InvoiceHeaderSchema = z.object({
  contraparte_nombre: z.string().nullish(),
  contraparte_cuit: z.string().nullish(),
  punto_venta: z.number().nullish(),
  numero: z.number().nullish(),
  letra: z.enum(["A", "B", "C"]).nullish(),
  fecha: z.string().nullish(),
  condicion_pago: z.string().nullish(),
  fch_vto_pago: z.string().nullish(),
  moneda: z.enum(["ARS", "USD"]).nullish(),
  importe_neto: z.number().nullish(),
  importe_iva: z.number().nullish(),
  importe_trib: z.number().nullish(),
  importe_total: z.number().nullish(),
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
  contraparte_nombre: z.string().nullish(),
  contraparte_cuit: z.string().nullish(),
  numero: z.number().nullish(),
  fecha: z.string().nullish(),
  moneda: z.enum(["ARS", "USD"]).nullish(),
  importe_total: z.number().nullish(),
});
export type ReceiptExtraction = z.infer<typeof ReceiptExtractionSchema>;

/** orden_pago. */
export const PaymentOrderExtractionSchema = z.object({
  contraparte_nombre: z.string().nullish(),
  contraparte_cuit: z.string().nullish(),
  numero: z.number().nullish(),
  fecha: z.string().nullish(),
  moneda: z.enum(["ARS", "USD"]).nullish(),
  importe_total: z.number().nullish(),
});
export type PaymentOrderExtraction = z.infer<typeof PaymentOrderExtractionSchema>;

/**
 * Extraction schema per document kind. Kinds without a structured create-flow
 * yet (remito/cheque/extracto/otro) are absent — the engine falls back to
 * classification-only for those.
 */
export const EXTRACTION_SCHEMAS = {
  factura_compra: InvoiceExtractionSchema,
  factura_venta: InvoiceExtractionSchema,
  nc_nd: InvoiceExtractionSchema,
  recibo: ReceiptExtractionSchema,
  orden_pago: PaymentOrderExtractionSchema,
} as const;

export type ExtractableKind = keyof typeof EXTRACTION_SCHEMAS;

export function isExtractableKind(kind: string): kind is ExtractableKind {
  return kind in EXTRACTION_SCHEMAS;
}
