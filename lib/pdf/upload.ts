import "server-only";

import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

const BUCKET_NAME = "invoices-pdf";
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface UploadResult {
  storagePath: string;
  signedUrl: string;
}

export async function uploadInvoicePdf(
  comprobanteId: string,
  pdf: Buffer,
): Promise<UploadResult> {
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
