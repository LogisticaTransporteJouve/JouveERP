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
import { generateInvoicePdfBuffer } from "@/lib/pdf/generate-and-hash";
import { getServiceClient } from "@/lib/supabase/service";

import type { ClientLegalJoin } from "@/features/clients/schema";

import { formatInvoiceNumero } from "../schema";
import type { ActionResult } from "@/lib/query/run-action";

/** Specific shape of `channel:invoicing_channels ( business_unit:business_units(name) )`
 *  returned by the send-invoice-email SELECT to get the issuer's name. */
type ChannelBusinessUnitJoin = {
  channel: { business_unit: { name: string } | null } | null;
};

const SendInvoiceEmailSchema = z.object({
  invoice_id: z.string().uuid(),
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

export type SendInvoiceEmailInput = z.input<typeof SendInvoiceEmailSchema>;

export async function sendInvoiceByEmailAction(
  rawInput: SendInvoiceEmailInput,
): Promise<ActionResult<{ log_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "email:send")) {
    return { ok: false, error: "No tenés permiso para enviar emails." };
  }
  if (!userCan(ctx.roles, "invoices:read")) {
    return { ok: false, error: "No tenés permiso para ver facturas." };
  }

  const parsed = SendInvoiceEmailSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const input = parsed.data;

  const supabase = getServiceClient();
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select(
      `id, kind, letter, punto_venta, numero, fecha, imp_total, status,
       channel:invoicing_channels(business_unit:business_units(name)),
       client:clients(legal_name)`,
    )
    .eq("id", input.invoice_id)
    .maybeSingle();

  if (invErr) return { ok: false, error: invErr.message };
  if (!invoice) return { ok: false, error: "Comprobante no encontrado." };
  if (invoice.status !== "emitted") {
    return {
      ok: false,
      error: "Solo se pueden enviar comprobantes en estado emitido.",
    };
  }

  const client = (invoice as unknown as ClientLegalJoin).client;
  const emisorName =
    (invoice as unknown as ChannelBusinessUnitJoin).channel?.business_unit
      ?.name ?? "DZ & Sons";

  const numeroLabel = formatInvoiceNumero(
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
      userId: ctx.userId,
      invoice_id: input.invoice_id,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "No se pudo generar el PDF." };
  }

  const fechaLabel = formatArDateShort(invoice.fecha);
  const totalLabel = `$${formatNumber2(Number(invoice.imp_total))}`;
  const pdfFilename = buildPdfFilename(
    numeroLabel,
    client?.legal_name ?? "Cliente",
  );

  const result = await sendComprobanteByEmail({
    entity_type: "invoice",
    entity_id: input.invoice_id,
    recipient: input.recipient,
    subject: input.subject,
    body: input.body,
    emisor_name: emisorName,
    client_legal_name: client?.legal_name ?? "Cliente",
    numero_label: numeroLabel,
    fecha: fechaLabel,
    total_label: totalLabel,
    pdf_buffer: pdf.pdfBuffer,
    pdf_filename: pdfFilename,
    sent_by: ctx.userId,
  });

  if (!result.ok) return result;

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${input.invoice_id}`);

  return { ok: true, data: { log_id: result.data.log_id } };
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
  if (!userCan(ctx.roles, "invoices:read")) {
    return { ok: false, error: "No tenés permiso." };
  }

  const supabase = getServiceClient();
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select(
      "kind, letter, punto_venta, numero, notified_at, client:clients(legal_name, email)",
    )
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!invoice) return { ok: false, error: "Comprobante no encontrado." };

  const client = (invoice as unknown as ClientLegalJoin).client;

  const numeroLabel = formatInvoiceNumero(
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
      .eq("entity_id", invoiceId)
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
      subject: `Comprobante ${numeroLabel}`,
      numero_label: numeroLabel,
      client_legal_name: client?.legal_name ?? "Cliente",
      last_sent_at: invoice.notified_at,
    },
  };
}
