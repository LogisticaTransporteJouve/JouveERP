"use server";

import { z } from "zod";

import { requireUserContext } from "@/lib/auth/context";
import { isFiscalOnly, userCan } from "@/lib/auth/permissions";
import { sendInvoiceEmail } from "@/lib/commands/send-invoice-email";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

import {
  formatInvoiceNumero,
  SendInvoiceEmailSchema,
  type SendInvoiceEmailInput,
} from "../schema";

export async function sendInvoiceByEmailAction(
  rawInput: SendInvoiceEmailInput,
): Promise<ActionResult<{ log_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "email:send")) {
    return { ok: false, error: "No tenés permiso para enviar emails." };
  }
  if (!userCan(ctx.access, "invoices:read")) {
    return { ok: false, error: "No tenés permiso para ver facturas." };
  }

  const parsed = SendInvoiceEmailSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  return sendInvoiceEmail(ctx, parsed.data);
}

// Suggested defaults to prefill the dialog.
export async function getInvoiceEmailDefaultsAction(invoiceId: string): Promise<
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
    return { ok: false, error: "No tenés permiso." };
  }
  const id = z.string().uuid().safeParse(invoiceId);
  if (!id.success) return { ok: false, error: "Comprobante inválido." };

  const supabase = getServiceClient();
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select(
      "kind, letter, punto_venta, numero, notified_at, client:clients(legal_name, email), channel:invoicing_channels(is_fiscal)",
    )
    .eq("id", id.data)
    .maybeSingle();
  if (error) {
    logger.error("send_invoice_email.defaults_failed", {
      userId: ctx.userId,
      invoiceId: id.data,
      error,
    });
    return { ok: false, error: "No se pudo leer el comprobante." };
  }
  // A fiscal-only reader sees no internal comprobante (as getInvoiceDetail).
  if (!invoice || (isFiscalOnly(ctx.access) && !invoice.channel?.is_fiscal)) {
    return { ok: false, error: "Comprobante no encontrado." };
  }

  const client = invoice.client;

  const numberLabel = formatInvoiceNumero(
    invoice.kind,
    invoice.letter,
    invoice.punto_venta,
    invoice.numero,
  );

  // Look up the last successful send to suggest a recipient if the client
  // has no email on file.
  let lastRecipient: string | null = null;
  if (!client?.email) {
    const { data: lastLog } = await supabase
      .from("email_send_log")
      .select("recipient")
      .eq("entity_type", "invoice")
      .eq("entity_id", id.data)
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
      subject: `Comprobante ${numberLabel}`,
      numero_label: numberLabel,
      client_legal_name: client?.legal_name ?? "Cliente",
      last_sent_at: invoice.notified_at,
    },
  };
}
