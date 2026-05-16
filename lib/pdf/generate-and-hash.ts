import "server-only";

// M.0 — reemplazo de generate-and-store.ts (que subía a Storage).
//
// Ahora el PDF se regenera on-demand en cada request. En la emisión solo
// calculamos el SHA256 del buffer y lo persistimos en `invoices.pdf_hash`
// para tener prueba criptográfica de integridad. Si en el futuro alguien
// duda de un PDF entregado, se regenera y se compara hash.
//
// El QR AFIP es función pura de los datos (cae + receptor + importes) y
// siempre da el mismo URL escaneable, así que no perdemos validez fiscal
// al no guardar bytes.

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
 * Genera el PDF, calcula su hash y lo persiste en `invoices.pdf_hash`.
 * Usado en el step Inngest post-emisión. Idempotente: si ya hay un hash,
 * lo sobreescribe (regenerar una factura sin cambios debe dar el mismo
 * hash; si dio distinto, es bug del template y conviene saberlo).
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
