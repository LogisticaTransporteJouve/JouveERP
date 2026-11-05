import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database";
import { logger } from "@/lib/logger";

// The invoice of a billed source (a liquidación, a carga's flete) is issued
// under a key derived from the source and its attempt number, so the source
// has at most one live invoice: a "Facturar" after a lost link or an expired
// claim finds the invoice the first one queued, instead of issuing a second.
// The attempt moves on only when the previous invoice is void
// (billing_invoice_is_void: failed, cancelled, or a fiscal factura that,
// after its whole chain of emitted NCs and NDs, no longer bills anything:
// billing_invoice_live_amount), which is when the source is billable again,
// or when it is a draft with no items: the header and the items are written
// in two steps, so a kill or a failed rollback between them leaves a draft
// that no run ever sends (issue-invoice-reconcile resends only drafts with
// items), as the storage claim's relink already assumes.
// Only the newest attempt can be the live one: a later key exists only
// because every earlier attempt was void or itemless when it was taken. An
// earlier factura that a later ND makes bill again (void is not final any
// more) bills that ND, not the source, and is never adopted again.

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

function isVoidStatus(status: string): boolean {
  return status === "failed" || status === "cancelled";
}

/** billing_invoice_is_void, which also counts a fiscal factura its notes
 *  leave billing nothing. Null on a read error. */
async function readIsVoid(
  supabase: SupabaseClient<Database>,
  invoiceId: string,
): Promise<boolean | null> {
  const { data, error } = await supabase.rpc("billing_invoice_is_void", {
    p_invoice_id: invoiceId,
  });
  if (error) {
    logger.error("source_invoice.status_read_failed", { invoiceId, error });
    return null;
  }
  return data === true;
}

/** The draft has items, so it is (or will be) sent. Null on a read error.
 *  The source's claim keeps a second «Facturar» out while the first one
 *  writes the items. */
async function draftHasItems(
  supabase: SupabaseClient<Database>,
  invoiceId: string,
): Promise<boolean | null> {
  const { data, error } = await supabase
    .from("invoice_items")
    .select("invoice_id")
    .eq("invoice_id", invoiceId)
    .limit(1);
  if (error || !data) {
    logger.error("source_invoice.items_read_failed", { invoiceId, error });
    return null;
  }
  return data.length > 0;
}

/** Where the source's next invoice stands, from the newest invoice already
 *  issued under its keys (whoever issued it). A read error is "error": the
 *  caller then issues nothing. */
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
  const newest = keys.findLastIndex((key) => byKey.has(key));
  const row = newest < 0 ? undefined : byKey.get(keys[newest]!);
  if (row !== undefined && !isVoidStatus(row.status)) {
    const live = await isLiveAttempt(supabase, row);
    if (live === null) return { kind: "error" };
    if (live) return { kind: "live", invoiceId: row.id };
  }
  const free = keys[newest + 1];
  return free ? { kind: "free", key: free } : { kind: "exhausted" };
}

/** A non-failed, non-cancelled attempt still bills its source: an emitted
 *  one its notes do not void, a draft with items, or one being sent. Null
 *  on a read error. */
async function isLiveAttempt(
  supabase: SupabaseClient<Database>,
  row: { id: string; status: string },
): Promise<boolean | null> {
  // Only an emitted factura carries emitted notes.
  if (row.status === "emitted") {
    const isVoid = await readIsVoid(supabase, row.id);
    return isVoid === null ? null : !isVoid;
  }
  if (row.status === "draft") return draftHasItems(supabase, row.id);
  return true;
}

/** The invoice no longer bills its source (billing_invoice_is_void). A read
 *  error answers false, so the caller keeps its claim (the safe side: no
 *  second invoice before the TTL). */
export async function invoiceIsVoid(
  supabase: SupabaseClient<Database>,
  invoiceId: string,
): Promise<boolean> {
  return (await readIsVoid(supabase, invoiceId)) === true;
}
