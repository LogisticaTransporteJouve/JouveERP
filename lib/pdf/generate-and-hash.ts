import "server-only";

// M.0 — replacement for generate-and-store.ts (which uploaded to Storage).
//
// Now the PDF is regenerated on-demand on each request. At issuance we only
// compute the SHA256 of the buffer and persist it in `invoices.pdf_hash`
// to have cryptographic proof of integrity. If in the future someone
// disputes a delivered PDF, it's regenerated and the hash is compared.
//
// The PDF's creation date is the invoice's emitted_at, so the bytes are
// reproducible. Hashes stored before that change (2026-10-31) were taken from
// a render stamped with the render time and cannot be reproduced.
//
// The AFIP QR is a pure function of the data (cae + receptor + amounts) and
// always yields the same scannable URL, so we don't lose fiscal validity
// by not storing the bytes.

import { createHash } from "node:crypto";

import { getServiceClient } from "@/lib/supabase/service";

import { renderInvoicePdf } from "./render";

import { buildTemplateData } from "./generate-and-store";
import type { InvoiceTemplateData } from "./invoice-template";

export interface GeneratedPdf {
  pdfBuffer: Buffer;
  pdfHash: string;
  data: InvoiceTemplateData;
}

export async function generateInvoicePdfBuffer(
  invoiceId: string,
): Promise<GeneratedPdf> {
  const data = await buildTemplateData(invoiceId);
  const pdfBuffer = await renderInvoicePdf(data);
  const pdfHash = createHash("sha256").update(pdfBuffer).digest("hex");
  return { pdfBuffer, pdfHash, data };
}

/**
 * Generates the PDF, computes its hash and persists it in `invoices.pdf_hash`.
 * Used in the post-issuance Inngest step. Idempotent: if a hash already
 * exists, it's overwritten (regenerating an unchanged invoice should yield
 * the same hash; if it differed, it's a template bug worth knowing about).
 */
export async function generateAndPersistInvoicePdfHash(
  invoiceId: string,
): Promise<GeneratedPdf> {
  const result = await generateInvoicePdfBuffer(invoiceId);
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("invoices")
    .update({ pdf_hash: result.pdfHash })
    .eq("id", invoiceId);
  if (error) throw new Error(`persist-pdf-hash: ${error.message}`);
  return result;
}
