"use server";

import { z } from "zod";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { sendComprobanteByEmail } from "@/lib/email/send-comprobante";
import { buildPdfFilename, formatNumber2 } from "@/lib/format";
import { logger } from "@/lib/logger";
import {
  buildFreightSettlementTemplateData,
  renderFreightSettlementPdf,
} from "@/lib/pdf/freight-settlement-render";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

import { formatRemitoR, formatSettlementNumber, hasRDocument } from "../schema";

// "Enviar por email" of a liquidación's R document (the Remito R of a fiscal
// one, or a legacy R-…), like a receipt's (send-receipt-email): its PDF
// attached, logged in email_send_log. An internal liquidación's remito
// interno X is an invoice and goes through send-invoice-email.

const SendFreightSettlementEmailSchema = z.object({
  settlement_id: z.string().uuid(),
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

export type SendFreightSettlementEmailInput = z.input<
  typeof SendFreightSettlementEmailSchema
>;

/** Only a live liquidación with its R (remito R or legacy R-…) has one to
 *  send. */
function sendable(s: {
  status: string;
  numero: number | null;
  remito_number: number | null;
}): boolean {
  return (
    (s.status === "confirmed" || s.status === "invoiced") && hasRDocument(s)
  );
}

const NOT_SENDABLE =
  "Solo se envía una liquidación con su remito R emitido (confirmada o facturada).";

export async function sendFreightSettlementByEmailAction(
  rawInput: SendFreightSettlementEmailInput,
): Promise<ActionResult<{ log_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "email:send")) {
    return { ok: false, error: "No tenés permiso para enviar emails." };
  }
  if (!userCan(ctx.access, "invoices:read")) {
    return { ok: false, error: "No tenés permiso para ver liquidaciones." };
  }
  const parsed = SendFreightSettlementEmailSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const input = parsed.data;

  const supabase = getServiceClient();
  const { data: settlement, error } = await supabase
    .from("freight_settlements")
    .select("id, status, numero, remito_number")
    .eq("id", input.settlement_id)
    .maybeSingle();
  if (error) {
    logger.error("send_freight_settlement_email.read_failed", {
      userId: ctx.userId,
      id: input.settlement_id,
      error,
    });
    return { ok: false, error: "No se pudo leer la liquidación." };
  }
  if (!settlement) return { ok: false, error: "Liquidación no encontrada." };
  if (!sendable(settlement)) return { ok: false, error: NOT_SENDABLE };

  let templateData;
  let pdfBuffer;
  try {
    templateData = await buildFreightSettlementTemplateData(
      input.settlement_id,
    );
    pdfBuffer = await renderFreightSettlementPdf(templateData);
  } catch (err) {
    logger.error("send_freight_settlement_email.pdf_failed", {
      userId: ctx.userId,
      id: input.settlement_id,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "No se pudo generar el PDF." };
  }

  const result = await sendComprobanteByEmail({
    entity_type: "freight_settlement",
    entity_id: input.settlement_id,
    recipient: input.recipient,
    subject: input.subject,
    body: input.body,
    emisor_name: templateData.emisor.legal_name,
    client_legal_name: templateData.client.legal_name,
    numero_label: templateData.number,
    fecha: templateData.period,
    total_label: `$${formatNumber2(templateData.total)}`,
    pdf_buffer: pdfBuffer,
    pdf_filename: buildPdfFilename(
      templateData.number,
      templateData.client.legal_name,
    ),
    sent_by: ctx.userId,
  });
  if (!result.ok) return result;

  await logAudit(
    "freight_settlement.emailed",
    ctx.userId,
    { log_id: result.data.log_id },
    input.settlement_id,
  );
  return { ok: true, data: { log_id: result.data.log_id } };
}

export async function getFreightSettlementEmailDefaultsAction(
  settlementId: string,
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
  if (!userCan(ctx.access, "invoices:read")) {
    return { ok: false, error: "No tenés permiso para ver liquidaciones." };
  }
  const id = z.string().uuid().safeParse(settlementId);
  if (!id.success) return { ok: false, error: "Liquidación inválida." };

  const supabase = getServiceClient();
  const [settlementRes, lastRes] = await Promise.all([
    supabase
      .from("freight_settlements")
      .select(
        "numero, status, remito_pos, remito_number, client:clients(legal_name, email)",
      )
      .eq("id", id.data)
      .maybeSingle(),
    supabase
      .from("email_send_log")
      .select("recipient, created_at")
      .eq("entity_type", "freight_settlement")
      .eq("entity_id", id.data)
      .eq("status", "sent")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (settlementRes.error || lastRes.error) {
    logger.error("send_freight_settlement_email.defaults_failed", {
      userId: ctx.userId,
      id: id.data,
      error: settlementRes.error ?? lastRes.error,
    });
    return { ok: false, error: "No se pudo leer la liquidación." };
  }
  const s = settlementRes.data;
  if (!s) return { ok: false, error: "Liquidación no encontrada." };
  if (!sendable(s)) return { ok: false, error: NOT_SENDABLE };
  const numeroLabel =
    s.remito_pos !== null && s.remito_number !== null
      ? formatRemitoR(s.remito_pos, s.remito_number)
      : formatSettlementNumber(s.numero);
  return {
    ok: true,
    data: {
      recipient: s.client?.email ?? lastRes.data?.recipient ?? null,
      subject: `Remito ${numeroLabel}`,
      numero_label: numeroLabel,
      client_legal_name: s.client?.legal_name ?? "Cliente",
      last_sent_at: lastRes.data?.created_at ?? null,
    },
  };
}
