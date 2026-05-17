"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
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
import { getServiceClient } from "@/lib/supabase/service";

import type { ClientLegalJoin } from "@/features/clients/schema";

import type { ActionResult } from "./receipts-actions";

const SendReceiptEmailSchema = z.object({
  receipt_id: z.string().uuid(),
  recipient: z.string().email("Email inválido."),
  subject: z
    .string()
    .min(1, "Asunto requerido.")
    .max(200, "Máx 200 caracteres."),
  body: z
    .string()
    .max(4000, "Máx 4000 caracteres.")
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v : null)),
});

export type SendReceiptEmailInput = z.input<typeof SendReceiptEmailSchema>;

function formatReceiptNumero(pos: number, numero: number): string {
  return `R${String(pos).padStart(4, "0")}-${String(numero).padStart(8, "0")}`;
}

export async function sendReceiptByEmailAction(
  rawInput: SendReceiptEmailInput,
): Promise<ActionResult<{ log_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "email:send")) {
    return { ok: false, error: "No tenés permiso para enviar emails." };
  }
  if (!userCan(ctx.roles, "receipts:read")) {
    return { ok: false, error: "No tenés permiso para ver recibos." };
  }

  const parsed = SendReceiptEmailSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const input = parsed.data;

  const supabase = getServiceClient();
  const { data: receipt, error: rErr } = await supabase
    .from("receipts")
    .select("id, status")
    .eq("id", input.receipt_id)
    .maybeSingle();
  if (rErr) return { ok: false, error: rErr.message };
  if (!receipt) return { ok: false, error: "Recibo no encontrado." };
  if (receipt.status !== "issued") {
    return {
      ok: false,
      error: "Solo se pueden enviar recibos emitidos.",
    };
  }

  // El template builder se encarga de traer toda la data necesaria.
  let templateData;
  let pdfBuffer;
  try {
    templateData = await buildReceiptTemplateData(input.receipt_id);
    pdfBuffer = await renderReceiptPdf(templateData);
  } catch (err) {
    logger.error("send_receipt_email.pdf_failed", {
      userId: ctx.userId,
      receipt_id: input.receipt_id,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "No se pudo generar el PDF." };
  }

  const numeroLabel = formatReceiptNumero(
    templateData.punto_venta,
    templateData.numero,
  );
  const fechaLabel = formatArDateShort(templateData.fecha);
  const totalLabel = `$${formatNumber2(templateData.total_amount)}`;
  const pdfFilename = buildPdfFilename(
    numeroLabel,
    templateData.receptor.legal_name,
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
    fecha: fechaLabel,
    total_label: totalLabel,
    pdf_buffer: pdfBuffer,
    pdf_filename: pdfFilename,
    sent_by: ctx.userId,
  });

  if (!result.ok) return result;

  revalidatePath("/receipts");
  revalidatePath(`/receipts/${input.receipt_id}`);

  return { ok: true, data: { log_id: result.data.log_id } };
}

export async function getReceiptEmailDefaultsAction(
  receiptId: string,
): Promise<
  ActionResult<{
    recipient: string | null;
    subject: string;
    numero_label: string;
    client_legal_name: string;
    last_sent_at: string | null;
  }>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "receipts:read")) {
    return { ok: false, error: "No tenés permiso." };
  }

  const supabase = getServiceClient();
  const { data: receipt, error } = await supabase
    .from("receipts")
    .select(
      "punto_venta, numero, notified_at, client:clients(legal_name, email)",
    )
    .eq("id", receiptId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!receipt) return { ok: false, error: "Recibo no encontrado." };

  const client = (receipt as unknown as ClientLegalJoin).client;

  const numeroLabel = formatReceiptNumero(receipt.punto_venta, receipt.numero);

  let lastRecipient: string | null = null;
  if (!client?.email) {
    const { data: lastLog } = await supabase
      .from("email_send_log")
      .select("recipient")
      .eq("entity_type", "receipt")
      .eq("entity_id", receiptId)
      .eq("status", "sent")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    lastRecipient = lastLog?.recipient ?? null;
  }

  return {
    ok: true,
    data: {
      recipient: client?.email ?? lastRecipient,
      subject: `Recibo ${numeroLabel}`,
      numero_label: numeroLabel,
      client_legal_name: client?.legal_name ?? "Cliente",
      last_sent_at: receipt.notified_at,
    },
  };
}
