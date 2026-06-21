/** Document kinds the classifier can return (docs/ai-overview.md §5-bis). */
export const DOCUMENT_KINDS = [
  "factura_compra",
  "factura_venta",
  "recibo",
  "orden_pago",
  "remito",
  "cheque",
  "extracto",
  "nc_nd",
  "otro",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Valid Argentine VAT rates (percent). 0 also covers exempt/untaxed. */
export const VALID_ALICUOTAS = [0, 2.5, 5, 10.5, 21, 27] as const;

export type Alicuota = (typeof VALID_ALICUOTAS)[number];

/** Extraction status mirrors the ai_document_extractions.status check. */
export type ExtractionStatus =
  | "pending_review"
  | "confirmed"
  | "discarded"
  | "failed";
