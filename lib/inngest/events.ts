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
