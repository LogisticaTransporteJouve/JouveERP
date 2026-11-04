import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";

import type { ReceivedVoucher } from "./mis-comprobantes/parse";

type Supabase = SupabaseClient<Database>;

const CHUNK = 500;

export type IngestCounts = {
  /** New vouchers in the tray, unsupported ones included. */
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
    counts.inserted += rows.length;
    counts.unsupported += rows.filter((r) => r.status === "unsupported").length;
    counts.alreadyInTray += chunk.length - rows.length;

    const pendingIds = rows
      .filter((r) => r.status === "pending_review")
      .map((r) => r.id);
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
