import { z } from "zod";

// Zod-validated event payloads. Functions parse the event with these schemas
// at the boundary so a malformed dispatch fails fast with a clear error
// instead of producing a runtime exception five steps in.

export const INVOICE_ISSUE_REQUESTED = "invoice/issue.requested" as const;

export const InvoiceIssueRequestedSchema = z.object({
  invoice_id: z.string().uuid(),
  idempotency_key: z.string().min(1),
  // Numbering scope of the draft: issue-invoice serializes its steps per
  // punto de venta so two emissions never race for the same AFIP numero.
  // Optional only for events queued before these fields existed; the action
  // always sends both.
  channel_id: z.string().min(1).optional(),
  punto_venta: z.number().int().optional(),
});

export type InvoiceIssueRequested = z.infer<typeof InvoiceIssueRequestedSchema>;

export const NOTIFICATIONS_DISPATCH = "notifications/dispatch" as const;

export const NotificationsDispatchSchema = z.object({
  // The message_id ties the batch together — the function loads all notifs
  // where metadata->>message_id = $1 and sends a push to each
  // recipient. Inngest's idempotency on this field prevents an
  // action retry from duplicating the pushes.
  message_id: z.string().uuid(),
});

export type NotificationsDispatch = z.infer<typeof NotificationsDispatchSchema>;

export const DOCUMENT_EXTRACTION_REQUESTED =
  "document/extraction.requested" as const;

export const DocumentExtractionRequestedSchema = z.object({
  // The pending ai_document_extractions row this run fills in.
  extraction_id: z.string().uuid(),
  file_id: z.string().uuid(),
  // Contextual mode (a): the kind is already known, skip classification.
  declared_type: z.string().nullish(),
});

export type DocumentExtractionRequested = z.infer<
  typeof DocumentExtractionRequestedSchema
>;
