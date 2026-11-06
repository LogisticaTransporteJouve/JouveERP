import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";

import type {
  ReceivedVoucher,
  UnreadableVoucher,
} from "./mis-comprobantes/parse";

type Supabase = SupabaseClient<Database>;

const CHUNK = 500;

export type IngestCounts = {
  /** New vouchers in the tray, unsupported ones included, and ones that
   *  could not be read before and now could. */
  inserted: number;
  unsupported: number;
  /** Already in the tray from an earlier file or run. */
  alreadyInTray: number;
  /** New vouchers that matched a purchase already loaded. */
  linked: number;
};

/** Adds the vouchers to the tray (arca_received_vouchers), skipping the ones
 *  it already holds, and links the new ones to a purchase already loaded.
 *  Null when a write failed (logged); vouchers written before the failure
 *  stay. */
export async function ingestReceivedVouchers(
  supabase: Supabase,
  vouchers: readonly ReceivedVoucher[],
  source: { origin: "upload" | "sync"; runId?: string | null },
): Promise<IngestCounts | null> {
  const counts: IngestCounts = {
    inserted: 0,
    unsupported: 0,
    alreadyInTray: 0,
    linked: 0,
  };
  for (let i = 0; i < vouchers.length; i += CHUNK) {
    const chunk = vouchers.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("arca_received_vouchers")
      .upsert(
        chunk.map((v) => ({
          ...v,
          origin: source.origin,
          run_id: source.runId ?? null,
          status: v.kind === null ? "unsupported" : "pending_review",
        })),
        {
          onConflict: "issuer_cuit,cbte_tipo,punto_venta,numero",
          ignoreDuplicates: true,
        },
      )
      .select("id, status");
    if (error) {
      logger.error("arca_received.ingest.failed", { code: error.code });
      return null;
    }
    const rows = data ?? [];
    const recovered = await readNowRows(supabase, chunk, rows.length);
    if (recovered === null) return null;
    counts.inserted += rows.length + recovered.length;
    counts.unsupported += rows.filter((r) => r.status === "unsupported").length;
    counts.alreadyInTray += chunk.length - rows.length - recovered.length;

    const pendingIds = [
      ...rows.filter((r) => r.status === "pending_review").map((r) => r.id),
      ...recovered,
    ];
    if (pendingIds.length > 0) {
      const { data: linked, error: linkError } = await supabase.rpc(
        "link_received_vouchers",
        { p_ids: pendingIds },
      );
      if (linkError) {
        logger.error("arca_received.ingest.failed", { code: linkError.code });
        return null;
      }
      counts.linked += linked ?? 0;
    }
  }
  return counts;
}

const keyOf = (v: {
  issuer_cuit: string;
  cbte_tipo: number;
  punto_venta: number;
  numero: number;
}) => `${v.issuer_cuit}|${v.cbte_tipo}|${v.punto_venta}|${v.numero}`;

/** The vouchers of a chunk that were in the tray as «No se pudieron leer»
 *  and read now: they take the amounts read and go to pending. Their ids, or
 *  null when a write failed (logged). */
async function readNowRows(
  supabase: Supabase,
  chunk: readonly ReceivedVoucher[],
  inserted: number,
): Promise<string[] | null> {
  if (inserted === chunk.length) return [];
  const supported = chunk.filter((v) => v.kind !== null);
  if (supported.length === 0) return [];
  const { data, error } = await supabase
    .from("arca_received_vouchers")
    .select("id, issuer_cuit, cbte_tipo, punto_venta, numero")
    .eq("status", "unreadable")
    .in("issuer_cuit", [...new Set(supported.map((v) => v.issuer_cuit))]);
  if (error) {
    logger.error("arca_received.ingest.failed", { code: error.code });
    return null;
  }
  const byKey = new Map(supported.map((v) => [keyOf(v), v]));
  const ids: string[] = [];
  for (const row of data ?? []) {
    const voucher = byKey.get(keyOf(row));
    if (!voucher) continue;
    const { data: updated, error: updateError } = await supabase
      .from("arca_received_vouchers")
      .update({
        ...voucher,
        status: "pending_review",
        unreadable_reason: null,
        raw_amounts: null,
      })
      .eq("id", row.id)
      .eq("status", "unreadable")
      .select("id")
      .maybeSingle();
    if (updateError) {
      logger.error("arca_received.ingest.failed", { code: updateError.code });
      return null;
    }
    if (updated) ids.push(updated.id);
  }
  return ids;
}

/** Keeps the rows whose amounts could not be read in the tray, as «No se
 *  pudieron leer», skipping the ones it already holds (in any state). The
 *  number added, or null when a write failed (logged). */
export async function ingestUnreadableVouchers(
  supabase: Supabase,
  rows: readonly UnreadableVoucher[],
  source: { origin: "upload" | "sync"; runId?: string | null },
): Promise<number | null> {
  let added = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("arca_received_vouchers")
      .upsert(
        chunk.map((v) => ({
          ...v,
          origin: source.origin,
          run_id: source.runId ?? null,
          status: "unreadable",
          imp_total: 0,
        })),
        {
          onConflict: "issuer_cuit,cbte_tipo,punto_venta,numero",
          ignoreDuplicates: true,
        },
      )
      .select("id");
    if (error) {
      logger.error("arca_received.ingest_unreadable.failed", {
        code: error.code,
      });
      return null;
    }
    added += data?.length ?? 0;
  }
  return added;
}
