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
  tipo: z.enum(DOCUMENT_KINDS),
  confianza: z.number().min(0).max(1),
  moneda: z.enum(["ARS", "USD"]).nullish(),
  pistas: z.string().nullish(),
});
export type Classification = z.infer<typeof ClassificationSchema>;

/** A party as printed on the document (emisor / receptor). */
export const PartySchema = z.object({
  nombre: z.string().nullish(),
  cuit: z.string().nullish(),
  condicion_iva: z.string().nullish(),
  domicilio: z.string().nullish(),
  localidad: z.string().nullish(),
  provincia: z.string().nullish(),
});
export type Party = z.infer<typeof PartySchema>;

/** Payment details printed on an invoice. */
export const PaymentSchema = z.object({
  metodo: z.string().nullish(),
  cbu: z.string().nullish(),
  alias: z.string().nullish(),
  banco: z.string().nullish(),
});
export type Payment = z.infer<typeof PaymentSchema>;

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
 * schemas and extracted in two calls (engine.ts) — historically to dodge the
 * union-parameter ceiling, kept because it also keeps each call focused.
 * `contraparte_*` (flat) stays the canonical counterparty for matching/mapping;
 * `emisor`/`receptor`/`pago` are additive richer fields for the preview.
 */
export const InvoiceHeaderSchema = z.object({
  contraparte_nombre: z.string().nullish(),
  contraparte_cuit: z.string().nullish(),
  emisor: PartySchema.nullish(),
  receptor: PartySchema.nullish(),
  pago: PaymentSchema.nullish(),
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
export type PaymentOrderExtraction = z.infer<
  typeof PaymentOrderExtractionSchema
>;

/** One remito line — goods moved, no amounts. */
export const RemitoItemSchema = z.object({
  descripcion: z.string(),
  codigo: z.string().nullish(),
  cod_afip: z.string().nullish(),
  cantidad: z.number().nullish(),
  unidad: z.string().nullish(),
  unidades: z.number().nullish(),
  tipo_embalaje: z.string().nullish(),
});
export type RemitoItem = z.infer<typeof RemitoItemSchema>;

/** remito — a delivery note: products + quantities, no prices. */
export const RemitoExtractionSchema = z.object({
  contraparte_nombre: z.string().nullish(),
  contraparte_cuit: z.string().nullish(),
  punto_venta: z.number().nullish(),
  numero: z.number().nullish(),
  fecha: z.string().nullish(),
  fecha_entrega: z.string().nullish(),
  destino: z.string().nullish(),
  transportista: z.string().nullish(),
  conductor: z.string().nullish(),
  dominio_vehiculo: z.string().nullish(),
  total_kilos: z.number().nullish(),
  cre: z.string().nullish(),
  observaciones: z.string().nullish(),
  items: z.array(RemitoItemSchema).default([]),
});
export type RemitoExtraction = z.infer<typeof RemitoExtractionSchema>;

/** cheque. */
export const ChequeExtractionSchema = z.object({
  banco: z.string().nullish(),
  numero: z.string().nullish(),
  fecha: z.string().nullish(),
  fecha_pago: z.string().nullish(),
  importe: z.number().nullish(),
  beneficiario: z.string().nullish(),
  moneda: z.enum(["ARS", "USD"]).nullish(),
  tipo: z.enum(["propio", "tercero", "diferido"]).nullish(),
});
export type ChequeExtraction = z.infer<typeof ChequeExtractionSchema>;

/** One bank-statement movement. */
export const ExtractoMovimientoSchema = z.object({
  fecha: z.string().nullish(),
  concepto: z.string(),
  debito: z.number().nullish(),
  credito: z.number().nullish(),
  saldo: z.number().nullish(),
});
export type ExtractoMovimiento = z.infer<typeof ExtractoMovimientoSchema>;

/** extracto bancario. */
export const ExtractoBancarioExtractionSchema = z.object({
  banco: z.string().nullish(),
  cuenta: z.string().nullish(),
  periodo: z.string().nullish(),
  saldo_inicial: z.number().nullish(),
  saldo_final: z.number().nullish(),
  moneda: z.enum(["ARS", "USD"]).nullish(),
  movimientos: z.array(ExtractoMovimientoSchema).default([]),
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
  cheque: ChequeExtractionSchema,
  extracto: ExtractoBancarioExtractionSchema,
} as const;

export type ExtractableKind = keyof typeof EXTRACTION_SCHEMAS;

export function isExtractableKind(kind: string): kind is ExtractableKind {
  return kind in EXTRACTION_SCHEMAS;
}
