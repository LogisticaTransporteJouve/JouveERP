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
} as const;

export type AttachmentFkTarget = keyof typeof ATTACHMENT_FK_COLUMN;
