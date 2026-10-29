import type { Permission } from "@/lib/auth/permissions";

// The entities files hang off and search finds, with the read permission of
// each: a file or a search hit is shown only to whoever can read what it
// belongs to.

export const ENTITY_TYPES = [
  "purchase_invoice",
  "invoice",
  "receipt",
  "payment_order",
  "check",
  "issued_check",
  "client",
  "supplier",
  "transaction",
  "ai_document",
  "ai_chat_message",
  "employee_document",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_READ_PERMISSION: Record<EntityType, Permission> = {
  purchase_invoice: "purchase_invoices:read",
  invoice: "invoices:read",
  receipt: "receipts:read",
  payment_order: "payment_orders:read",
  check: "cheques:read",
  issued_check: "issued_checks:read",
  client: "clients:read",
  supplier: "suppliers:read",
  transaction: "transactions:read",
  ai_document: "ai:read",
  ai_chat_message: "ai:chat",
  employee_document: "hr:read",
};
