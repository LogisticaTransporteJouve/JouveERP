"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { sendReceiptEmail } from "@/lib/commands/send-receipt-email";
import { dbErrorMessage } from "@/lib/db/guard-errors";
import { getServiceClient } from "@/lib/supabase/service";

import type { ClientLegalJoin } from "@/features/clients/schema";

import {
  formatReceiptNumber,
  SendReceiptEmailSchema,
  type SendReceiptEmailInput,
} from "../schema";

import type { ActionResult } from "@/lib/query/run-action";

export async function sendReceiptByEmailAction(
  rawInput: SendReceiptEmailInput,
): Promise<ActionResult<{ log_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "email:send")) {
    return { ok: false, error: "No tenés permiso para enviar emails." };
  }
  if (!userCan(ctx.access, "receipts:read")) {
    return { ok: false, error: "No tenés permiso para ver recibos." };
  }

  const parsed = SendReceiptEmailSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  return sendReceiptEmail(ctx.userId, parsed.data);
}

export async function getReceiptEmailDefaultsAction(receiptId: string): Promise<
  ActionResult<{
    recipient: string | null;
    subject: string;
    numero_label: string;
    client_legal_name: string;
    last_sent_at: string | null;
  }>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "receipts:read")) {
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
  if (error) {
    return {
      ok: false,
      error: dbErrorMessage(
        error,
        { slug: "receipts.email_status.read_failed", userId: ctx.userId },
        "No se pudo leer el recibo.",
      ),
    };
  }
  if (!receipt) return { ok: false, error: "Recibo no encontrado." };

  const client = (receipt as unknown as ClientLegalJoin).client;

  const numeroLabel = formatReceiptNumber(receipt.punto_venta, receipt.numero);

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
