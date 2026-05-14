import { z } from "zod";

// Zod-validated event payloads. Functions parse the event with these schemas
// at the boundary so a malformed dispatch fails fast with a clear error
// instead of producing a runtime exception five steps in.

export const INVOICE_ISSUE_REQUESTED = "invoice/issue.requested" as const;

export const InvoiceIssueRequestedSchema = z.object({
  invoice_id: z.string().uuid(),
  idempotency_key: z.string().min(1),
});

export type InvoiceIssueRequested = z.infer<typeof InvoiceIssueRequestedSchema>;

export const NOTIFICATIONS_DISPATCH = "notifications/dispatch" as const;

export const NotificationsDispatchSchema = z.object({
  // El message_id ata el batch — la función carga todas las notifs
  // donde metadata->>message_id = $1 y manda un push a cada
  // recipient. La idempotencia de Inngest sobre este campo evita que
  // un retry del action duplique los pushes.
  message_id: z.string().uuid(),
});

export type NotificationsDispatch = z.infer<typeof NotificationsDispatchSchema>;
