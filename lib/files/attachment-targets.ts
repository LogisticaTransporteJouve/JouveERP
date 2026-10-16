/** file_attachments FK column for each attachable entity. */
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
