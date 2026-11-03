import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database";
import { logger } from "@/lib/logger";

// The invoice of a billed source (a liquidación, a carga's flete) is issued
// under a key derived from the source and its attempt number, so the source
// has at most one live invoice: a "Facturar" after a lost link or an expired
// claim finds the invoice the first one queued, instead of issuing a second.
// The attempt moves on only when the previous invoice is void (failed or
// cancelled), which is when the source is billable again.

export type InvoiceSource = "freight_settlement" | "shipment_freight";

/** Attempts probed per source; past this, billing it again is refused. */
export const MAX_INVOICE_ATTEMPTS = 20;

// Fixed namespace of these keys (a random v4, generated once).
const NAMESPACE = "6f1e2c84-3b7a-4d59-9a0e-58c2d71b4f36";

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

/** RFC 9562 UUIDv5 of `name` under NAMESPACE. */
function uuidV5(name: string): string {
  const hash = createHash("sha1")
    .update(uuidBytes(NAMESPACE))
    .update(name, "utf8")
    .digest();
  const b = hash.subarray(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function sourceInvoiceKey(
  source: InvoiceSource,
  sourceId: string,
  attempt: number,
): string {
  return uuidV5(`${source}:${sourceId}:${attempt}`);
}

export type SourceInvoiceSlot =
  /** An invoice of the source is live: link it, issue nothing. */
  | { kind: "live"; invoiceId: string }
  /** Every earlier attempt is void: issue under this key. */
  | { kind: "free"; key: string }
  | { kind: "exhausted" }
  | { kind: "error" };

function isVoid(status: string): boolean {
  return status === "failed" || status === "cancelled";
}

/** Where the source's next invoice stands, from the invoices already issued
 *  under its keys (whoever issued them). A read error is "error": the caller
 *  then issues nothing. */
export async function findSourceInvoiceSlot(
  supabase: SupabaseClient<Database>,
  source: InvoiceSource,
  sourceId: string,
): Promise<SourceInvoiceSlot> {
  const keys = Array.from({ length: MAX_INVOICE_ATTEMPTS }, (_, attempt) =>
    sourceInvoiceKey(source, sourceId, attempt),
  );
  const { data, error } = await supabase
    .from("invoices")
    .select("id, status, idempotency_key")
    .in("idempotency_key", keys);
  if (error || !data) {
    logger.error("source_invoice.lookup_failed", { source, sourceId, error });
    return { kind: "error" };
  }
  const byKey = new Map(data.map((row) => [row.idempotency_key, row]));
  const live = keys
    .map((key) => byKey.get(key))
    .find((row) => row !== undefined && !isVoid(row.status));
  if (live) return { kind: "live", invoiceId: live.id };
  const free = keys.find((key) => !byKey.has(key));
  return free ? { kind: "free", key: free } : { kind: "exhausted" };
}
