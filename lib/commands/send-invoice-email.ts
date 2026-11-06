import "server-only";

import { revalidatePath } from "next/cache";
import type { z } from "zod";

import type { ClientLegalJoin } from "@/features/clients/schema";
import {
  formatInvoiceNumero,
  type SendInvoiceEmailSchema,
} from "@/features/invoices/schema";
import { isFiscalOnly, type Access } from "@/lib/auth/permissions";
import { sendComprobanteByEmail } from "@/lib/email/send-comprobante";
import {
  buildPdfFilename,
  formatArDateShort,
  formatNumber2,
} from "@/lib/format";
import { logger } from "@/lib/logger";
import { DIVISION_LABEL } from "@/lib/pdf/emisor";
import { generateInvoicePdfBuffer } from "@/lib/pdf/generate-and-hash";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

/** Shape of `channel:invoicing_channels(name, is_fiscal,
 *  business_unit:business_units(name))`: the issuer's name and whether the
 *  comprobante is fiscal. */
type ChannelBusinessUnitJoin = {
  channel: {
    name: string;
    is_fiscal: boolean;
    business_unit: { name: string } | null;
  } | null;
};

/**
 * Sends an emitted comprobante's PDF by email (logged in `email_send_log`).
 * A fiscal-only reader cannot reach an internal one. The caller has already
 * checked `email:send` + `invoices:read` and parsed the input with
 * `SendInvoiceEmailSchema`: the «Enviar por email» dialog and an accepted
 * assistant proposal.
 */
export async function sendInvoiceEmail(
  actor: { userId: string; access: Access },
  input: z.output<typeof SendInvoiceEmailSchema>,
): Promise<ActionResult<{ log_id: string }>> {
  const supabase = getServiceClient();
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select(
      `id, kind, letter, punto_venta, numero, fecha, imp_total, status,
       channel:invoicing_channels(name, is_fiscal, business_unit:business_units(name)),
       client:clients(legal_name)`,
    )
    .eq("id", input.invoice_id)
    .maybeSingle();

  if (invErr) {
    logger.error("send_invoice_email.read_failed", {
      userId: actor.userId,
      invoiceId: input.invoice_id,
      error: invErr,
    });
    return { ok: false, error: "No se pudo leer el comprobante." };
  }
  if (!invoice || (isFiscalOnly(actor.access) && !invoice.channel?.is_fiscal)) {
    return { ok: false, error: "Comprobante no encontrado." };
  }
  if (invoice.status !== "emitted") {
    return {
      ok: false,
      error: "Solo se pueden enviar comprobantes en estado emitido.",
    };
  }

  const client = (invoice as unknown as ClientLegalJoin).client;
  const channel = (invoice as unknown as ChannelBusinessUnitJoin).channel;
  const isFiscal = channel?.is_fiscal ?? true;
  // D5: an internal comprobante goes out under the division, never under the
  // fiscal issuer.
  const emisorName = isFiscal
    ? (channel?.business_unit?.name ?? "DZ & Sons")
    : DIVISION_LABEL;

  const numberLabel = formatInvoiceNumero(
    invoice.kind,
    invoice.letter,
    invoice.punto_venta,
    invoice.numero,
  );

  let pdf;
  try {
    pdf = await generateInvoicePdfBuffer(input.invoice_id);
  } catch (err) {
    logger.error("send_invoice_email.pdf_failed", {
      userId: actor.userId,
      invoice_id: input.invoice_id,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "No se pudo generar el PDF." };
  }

  const dateLabel = formatArDateShort(invoice.fecha);
  const totalLabel = `$${formatNumber2(Number(invoice.imp_total))}`;
  const pdfFilename = buildPdfFilename(
    numberLabel,
    client?.legal_name ?? "Cliente",
  );

  const result = await sendComprobanteByEmail({
    entity_type: "invoice",
    entity_id: input.invoice_id,
    recipient: input.recipient,
    subject: input.subject,
    body: input.body,
    emisor_name: emisorName,
    internal: !isFiscal,
    client_legal_name: client?.legal_name ?? "Cliente",
    numero_label: numberLabel,
    fecha: dateLabel,
    total_label: totalLabel,
    pdf_buffer: pdf.pdfBuffer,
    pdf_filename: pdfFilename,
    sent_by: actor.userId,
  });

  if (!result.ok) return result;

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${input.invoice_id}`);

  return { ok: true, data: { log_id: result.data.log_id } };
}
