import { userCan, type Access, type Permission } from "@/lib/auth/permissions";

/** file_attachments FK column for each entity a user attaches files to.
 *  `ai_chat_message_id` is not here on purpose: chat links are written only
 *  by the chat route (features/ai/attachments/store.ts), never by upload. */
export const ATTACHMENT_FK_COLUMN = {
  purchase_invoice: "purchase_invoice_id",
  invoice: "invoice_id",
  receipt: "receipt_id",
  payment_order: "payment_order_id",
  check: "check_id",
  issued_check: "issued_check_id",
  client: "client_id",
  supplier: "supplier_id",
  transaction: "transaction_id",
  fuel_load: "fuel_load_id",
  tax_document: "tax_document_id",
} as const;

export type AttachmentFkTarget = keyof typeof ATTACHMENT_FK_COLUMN;

/** The record's write permission, which attaching a file to it or removing
 *  one takes on top of `files:write`. */
export const ATTACHMENT_WRITE_PERMISSION: Record<
  AttachmentFkTarget,
  Permission
> = {
  purchase_invoice: "purchase_invoices:write",
  invoice: "invoices:issue",
  receipt: "receipts:write",
  payment_order: "payment_orders:write",
  check: "cheques:write",
  issued_check: "issued_checks:write",
  client: "clients:write",
  supplier: "suppliers:write",
  transaction: "transactions:write",
  fuel_load: "fuel:write",
  tax_document: "taxes:write",
};

/** Whether `access` may attach files to, or remove them from, a `target`. */
export function canChangeAttachments(
  access: Access,
  target: AttachmentFkTarget,
): boolean {
  return (
    userCan(access, "files:write") &&
    userCan(access, ATTACHMENT_WRITE_PERMISSION[target])
  );
}
