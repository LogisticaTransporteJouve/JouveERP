import "server-only";

import { generateObject, type ModelMessage } from "ai";

import { buildClassifierModel, buildExtractionModel } from "../model";
import {
  ClassificationSchema,
  EXTRACTION_SCHEMAS,
  InvoiceHeaderSchema,
  InvoiceItemsSchema,
  type Classification,
  type ExtractableKind,
} from "./schemas";

// Invoice-style kinds are extracted as header + items in two focused calls.
const INVOICE_KINDS = new Set<ExtractableKind>([
  "factura_compra",
  "factura_venta",
  "nc_nd",
]);

// Force the json-tool path instead of Anthropic's constrained-decoding
// structured outputs. Extraction schemas have many optional/nullable fields,
// which make the grammar compilation blow up ("too many parameters with union
// types" / "grammar compilation timed out"). A plain json tool is sent instead
// (no grammar) and the result is still validated by Zod.
const ANTHROPIC_OBJECT_OPTIONS = {
  anthropic: { structuredOutputMode: "jsonTool" },
};

// Per-kind focus line appended to the extraction prompt (Sumary's document_focus
// idea), so the model knows what matters for each document type.
const KIND_HINT: Record<ExtractableKind, string> = {
  factura_compra:
    "This is a purchase invoice: DZ & Sons is the buyer; the counterparty is the supplier/seller.",
  factura_venta:
    "This is a sales invoice: DZ & Sons is the seller; the counterparty is the customer/buyer.",
  nc_nd: "This is a credit or debit note: treat it as an invoice (header + items).",
  recibo: "This is a receipt: extract the counterparty, number, date and total amount.",
  orden_pago:
    "This is a payment order: extract the counterparty, number, date and total amount.",
  remito:
    "This is a delivery note: extract products and quantities per line, WITHOUT amounts (delivery notes carry no prices).",
  cheque:
    "There may be ONE or SEVERAL checks in the same image (sometimes 4 or more). Extract ALL of them, one object per check in 'cheques'. For each one: bank, series, number, amount, payee, drawer (account holder) and their CUIT, account number, issue date, and payment/due date if it is post-dated (CPD). tipo: propio/tercero/diferido.",
  extracto:
    "This is a bank statement: one row per transaction (date, description, debit, credit, balance) plus opening and closing balance.",
};

export type DocumentBytes = { bytes: Uint8Array; mediaType: string };

/** Build the model content part for a document (image vs PDF/other). */
function documentPart(doc: DocumentBytes) {
  if (doc.mediaType.startsWith("image/")) {
    return {
      type: "image" as const,
      image: doc.bytes,
      mediaType: doc.mediaType,
    };
  }
  return {
    type: "file" as const,
    data: doc.bytes,
    mediaType: doc.mediaType || "application/pdf",
  };
}

const CLASSIFY_SYSTEM = `You are a classifier of Argentine accounting/commercial documents. You look at the document and decide what it is, without making anything up. You return the type, a confidence 0..1 and, if you can see it, the currency. Possible types: purchase invoice, sales invoice, receipt, payment order, delivery note, check, bank statement, credit/debit note, or other.`;

const EXTRACT_SYSTEM = `You are a data extractor for Argentine accounting documents. COPY EXACTLY what appears in the document; if a value does not appear, return null (do not invent or compute it: missing values are filled in afterwards deterministically). Amounts as numbers, without thousands separators or symbol (1234.56). Dates in YYYY-MM-DD format.
Line rules (invoices/delivery notes): one row per visible line; do not group or merge; skip subtotal/total rows and rows that are only an IVA label.
Amount rules: if the column says "con IVA" use importe_total; if it says "sin IVA" use importe_neto; when ambiguous cross-check against the totals. On tickets and receipts prices usually include IVA.
Counterparty: DZ & Sons S.A. is the own company; the counterparty (contraparte_nombre/contraparte_cuit) is ALWAYS the other party.`;

/** Stage 1 — classify an unknown document (generic-tray mode). */
export async function classifyDocument(
  doc: DocumentBytes,
  contextHint?: string,
): Promise<Classification> {
  const content: ModelMessage["content"] = [
    {
      type: "text",
      text: `Classify this document.${contextHint ? ` Context: ${contextHint}.` : ""}`,
    },
    documentPart(doc),
  ];
  const { object } = await generateObject({
    model: buildClassifierModel(),
    schema: ClassificationSchema,
    schemaName: "DocumentClassification",
    system: CLASSIFY_SYSTEM,
    maxRetries: 2,
    messages: [{ role: "user", content }],
    providerOptions: ANTHROPIC_OBJECT_OPTIONS,
  });
  return object;
}

/** Stage 2 — extract structured data with the schema for `kind`. */
export async function extractDocument(
  kind: ExtractableKind,
  doc: DocumentBytes,
): Promise<unknown> {
  const content: ModelMessage["content"] = [
    {
      type: "text",
      text: `Extract the data from this document (kind: ${kind}). ${KIND_HINT[kind] ?? ""}`.trim(),
    },
    documentPart(doc),
  ];

  // Invoices: extract header and line items separately so each call stays focused.
  if (INVOICE_KINDS.has(kind)) {
    const [header, lines] = await Promise.all([
      generateObject({
        model: buildExtractionModel(),
        schema: InvoiceHeaderSchema,
        schemaName: "InvoiceHeaderExtraction",
        system: EXTRACT_SYSTEM,
        maxRetries: 2,
        messages: [{ role: "user", content }],
        providerOptions: ANTHROPIC_OBJECT_OPTIONS,
      }),
      generateObject({
        model: buildExtractionModel(),
        schema: InvoiceItemsSchema,
        schemaName: "InvoiceItemsExtraction",
        system: EXTRACT_SYSTEM,
        maxRetries: 2,
        messages: [{ role: "user", content }],
        providerOptions: ANTHROPIC_OBJECT_OPTIONS,
      }),
    ]);
    return { ...header.object, items: lines.object.items };
  }

  const { object } = await generateObject({
    model: buildExtractionModel(),
    schema: EXTRACTION_SCHEMAS[kind],
    schemaName: "DocumentExtraction",
    system: EXTRACT_SYSTEM,
    maxRetries: 2,
    messages: [{ role: "user", content }],
    providerOptions: ANTHROPIC_OBJECT_OPTIONS,
  });
  return object;
}
