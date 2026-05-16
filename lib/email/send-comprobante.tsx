import "server-only";

import { render } from "@react-email/render";

import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import {
  getEmailFrom,
  getEmailReplyTo,
  getResendClient,
  isEmailConfigured,
} from "./client";
import { InvoiceEmail } from "./templates/invoice-email";
import { ReceiptEmail } from "./templates/receipt-email";

export type EntityType = "invoice" | "receipt";

export interface SendComprobanteByEmailInput {
  entity_type: EntityType;
  entity_id: string;
  recipient: string;
  subject: string;
  body: string | null;
  // Datos para el template (header/preview/detalle).
  emisor_name: string;
  client_legal_name: string;
  numero_label: string;
  fecha: string;
  total_label: string;
  // PDF que se adjunta.
  pdf_buffer: Buffer;
  pdf_filename: string;
  sent_by: string | null;
}

export interface SendComprobanteByEmailResult {
  log_id: string;
  provider_message_id: string | null;
}

// Resend + log + (success only) bump del notified_at de la entity. Devuelve
// error string si falla — el caller decide cómo mostrarlo.
export async function sendComprobanteByEmail(
  input: SendComprobanteByEmailInput,
): Promise<{ ok: true; data: SendComprobanteByEmailResult } | { ok: false; error: string }> {
  if (!isEmailConfigured()) {
    return {
      ok: false,
      error:
        "Email no configurado. Pedile al administrador que setee RESEND_API_KEY y EMAIL_FROM.",
    };
  }

  const resend = getResendClient();
  if (!resend) {
    return { ok: false, error: "Email no configurado." };
  }

  const html = await render(
    input.entity_type === "invoice" ? (
      <InvoiceEmail
        emisor_name={input.emisor_name}
        client_legal_name={input.client_legal_name}
        numero_label={input.numero_label}
        fecha={input.fecha}
        total_label={input.total_label}
        custom_body={input.body}
      />
    ) : (
      <ReceiptEmail
        emisor_name={input.emisor_name}
        client_legal_name={input.client_legal_name}
        numero_label={input.numero_label}
        fecha={input.fecha}
        total_label={input.total_label}
        custom_body={input.body}
      />
    ),
  );

  const replyTo = getEmailReplyTo();
  const supabase = getServiceClient();

  let providerMessageId: string | null = null;
  let sendError: string | null = null;
  try {
    const result = await resend.emails.send({
      from: getEmailFrom(),
      to: input.recipient,
      replyTo,
      subject: input.subject,
      html,
      attachments: [
        {
          filename: input.pdf_filename,
          content: input.pdf_buffer,
        },
      ],
    });
    if (result.error) {
      sendError = result.error.message ?? "Error desconocido al enviar.";
    } else {
      providerMessageId = result.data?.id ?? null;
    }
  } catch (err) {
    sendError = err instanceof Error ? err.message : "Error desconocido.";
  }

  const status = sendError ? "failed" : "sent";

  const { data: log, error: logErr } = await supabase
    .from("email_send_log")
    .insert({
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      recipient: input.recipient,
      subject: input.subject,
      body: input.body,
      status,
      provider_message_id: providerMessageId,
      error: sendError,
      sent_by: input.sent_by,
    })
    .select("id")
    .single();

  if (logErr) {
    logger.error("email_send_log.insert_failed", {
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      err: logErr.message,
    });
  }

  if (sendError) {
    return { ok: false, error: sendError };
  }

  // Bump notified_at solo si el envío fue exitoso.
  if (input.entity_type === "invoice") {
    await supabase
      .from("invoices")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", input.entity_id);
  } else {
    await supabase
      .from("receipts")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", input.entity_id);
  }

  return {
    ok: true,
    data: {
      log_id: log?.id ?? "",
      provider_message_id: providerMessageId,
    },
  };
}
