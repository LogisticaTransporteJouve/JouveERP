/** Document kinds the classifier can return (docs/ai-overview.md §5-bis). */
export const DOCUMENT_KINDS = [
  "purchase_invoice",
  "sales_invoice",
  "receipt",
  "payment_order",
  "delivery_note",
  "check",
  "bank_statement",
  "credit_debit_note",
  "other",
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
