import "server-only";

import { revalidatePath } from "next/cache";
import type { z } from "zod";

import {
  formatReceiptNumber,
  type SendReceiptEmailSchema,
} from "@/features/receipts/schema";
import { dbErrorMessage } from "@/lib/db/guard-errors";
import { sendComprobanteByEmail } from "@/lib/email/send-comprobante";
import {
  buildPdfFilename,
  formatArDateShort,
  formatNumber2,
} from "@/lib/format";
import { logger } from "@/lib/logger";
import {
  buildReceiptTemplateData,
  renderReceiptPdf,
} from "@/lib/pdf/receipt-render";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

/**
 * Sends an issued receipt's PDF by email (logged in `email_send_log`). The
 * caller has already checked `email:send` + `receipts:read` and parsed the
 * input with `SendReceiptEmailSchema`: the «Enviar por email» dialog and an
 * accepted assistant proposal.
 */
export async function sendReceiptEmail(
  actorId: string,
  input: z.output<typeof SendReceiptEmailSchema>,
): Promise<ActionResult<{ log_id: string }>> {
  const supabase = getServiceClient();
  const { data: receipt, error: rErr } = await supabase
    .from("receipts")
    .select("id, status")
    .eq("id", input.receipt_id)
    .maybeSingle();
  if (rErr) {
    return {
      ok: false,
      error: dbErrorMessage(
        rErr,
        { slug: "receipts.email.read_failed", userId: actorId },
        "No se pudo leer el recibo.",
      ),
    };
  }
  if (!receipt) return { ok: false, error: "Recibo no encontrado." };
  if (receipt.status !== "issued") {
    return {
      ok: false,
      error: "Solo se pueden enviar recibos emitidos.",
    };
  }

  let templateData;
  let pdfBuffer;
  try {
    templateData = await buildReceiptTemplateData(input.receipt_id);
    pdfBuffer = await renderReceiptPdf(templateData);
  } catch (err) {
    logger.error("send_receipt_email.pdf_failed", {
      userId: actorId,
      receipt_id: input.receipt_id,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "No se pudo generar el PDF." };
  }

  const numeroLabel = formatReceiptNumber(
    templateData.punto_venta,
    templateData.numero,
  );
  const result = await sendComprobanteByEmail({
    entity_type: "receipt",
    entity_id: input.receipt_id,
    recipient: input.recipient,
    subject: input.subject,
    body: input.body,
    emisor_name: templateData.emisor.legal_name,
    client_legal_name: templateData.receptor.legal_name,
    numero_label: numeroLabel,
    fecha: formatArDateShort(templateData.fecha),
    total_label: `$${formatNumber2(templateData.total_amount)}`,
    pdf_buffer: pdfBuffer,
    pdf_filename: buildPdfFilename(
      numeroLabel,
      templateData.receptor.legal_name,
    ),
    sent_by: actorId,
  });

  if (!result.ok) return result;

  revalidatePath("/receipts");
  revalidatePath(`/receipts/${input.receipt_id}`);

  return { ok: true, data: { log_id: result.data.log_id } };
}
