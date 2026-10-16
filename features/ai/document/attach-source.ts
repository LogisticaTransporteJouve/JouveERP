import "server-only";

import type { TablesInsert } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import type { createClient } from "@/lib/supabase/server";

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/** Entities created from an extraction that can carry file attachments. */
export type SourceFileTarget = {
  table:
    "purchase_invoices" | "invoices" | "receipts" | "payment_orders" | "checks";
  id: string;
};

type AttachmentFk =
  | "purchase_invoice_id"
  | "invoice_id"
  | "receipt_id"
  | "payment_order_id"
  | "check_id";

/** FK column + attachment kind (per the files whitelist) for each target. */
const TARGET_ATTACHMENT: Record<
  SourceFileTarget["table"],
  { column: AttachmentFk; kind: string }
> = {
  purchase_invoices: { column: "purchase_invoice_id", kind: "comprobante" },
  invoices: { column: "invoice_id", kind: "comprobante" },
  receipts: { column: "receipt_id", kind: "comprobante" },
  payment_orders: { column: "payment_order_id", kind: "comprobante_pago" },
  checks: { column: "check_id", kind: "foto_cheque" },
};

export function sourceAttachmentRow(
  fileId: string,
  target: SourceFileTarget,
  userId: string,
): TablesInsert<"file_attachments"> {
  const base = {
    file_id: fileId,
    kind: TARGET_ATTACHMENT[target.table].kind,
    created_by: userId,
  };
  switch (target.table) {
    case "purchase_invoices":
      return { ...base, purchase_invoice_id: target.id };
    case "invoices":
      return { ...base, invoice_id: target.id };
    case "receipts":
      return { ...base, receipt_id: target.id };
    case "payment_orders":
      return { ...base, payment_order_id: target.id };
    case "checks":
      return { ...base, check_id: target.id };
  }
}

/**
 * Links the scanned file to the entity created from it, so it shows in that
 * entity's attachments. Idempotent; never fails the creation (the entity
 * already exists) — a failure is logged and reported as false.
 */
export async function attachSourceFile(
  supabase: ServerSupabase,
  input: { fileId: string; target: SourceFileTarget; userId: string },
): Promise<boolean> {
  const { column } = TARGET_ATTACHMENT[input.target.table];
  const { data: existing, error: lookupError } = await supabase
    .from("file_attachments")
    .select("id")
    .eq("file_id", input.fileId)
    .eq(column, input.target.id)
    .limit(1)
    .maybeSingle();
  if (lookupError) {
    logger.warn("ai.document.attach.lookup_failed", {
      fileId: input.fileId,
      table: input.target.table,
      error: lookupError.message,
    });
    return false;
  }
  if (existing) return true;

  const { error } = await supabase
    .from("file_attachments")
    .insert(sourceAttachmentRow(input.fileId, input.target, input.userId));
  if (error) {
    logger.warn("ai.document.attach.failed", {
      fileId: input.fileId,
      table: input.target.table,
      error: error.message,
    });
    return false;
  }
  return true;
}
