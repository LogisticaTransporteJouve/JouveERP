import "server-only";

import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

const BUCKET_NAME = "invoices-pdf";
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UploadResult {
  storagePath: string;
  signedUrl: string;
}

export async function uploadInvoicePdf(
  comprobanteId: string,
  pdf: Buffer,
): Promise<UploadResult> {
  // Defense-in-depth: el caller ya pasa un UUID que vino del workflow
  // Inngest o del detail page (ambos lo levantan del DB), pero validamos
  // de nuevo acá para que la storage key no pueda contener `../` o
  // separadores que escapen del bucket si en el futuro alguna call
  // path saltea esa garantía.
  if (!UUID_RE.test(comprobanteId)) {
    throw new Error(`pdf.upload: invalid comprobante id "${comprobanteId}"`);
  }

  const supabase = getServiceClient();
  const path = `${comprobanteId}.pdf`;

  const upload = await supabase.storage
    .from(BUCKET_NAME)
    .upload(path, pdf, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (upload.error) {
    logger.warn("pdf.upload_failed", {
      invoice_id: comprobanteId,
      err: upload.error.message,
    });
    throw new Error(`pdf.upload: ${upload.error.message}`);
  }

  const signed = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signed.error || !signed.data) {
    throw new Error(
      `pdf.signed_url: ${signed.error?.message ?? "unknown error"}`,
    );
  }

  return {
    storagePath: path,
    signedUrl: signed.data.signedUrl,
  };
}
