import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

type Supabase = SupabaseClient<Database>;

export type ArcaWebAccountState = "missing" | "ok" | "rejected";

const CountsSchema = z.object({
  inserted: z.number(),
  unsupported: z.number(),
  alreadyInTray: z.number(),
  linked: z.number(),
});

/** The stored result of a «Recibidos de ARCA» run (ReceivedSyncResult in
 *  received-sync.ts), read back loosely: codes stay strings. */
const SyncResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("skipped"), reason: z.string() }),
  z.object({ outcome: z.literal("sign_in_failed"), code: z.string() }),
  z.object({
    outcome: z.literal("done"),
    counts: CountsSchema,
    skippedRows: z.number(),
    failedMonths: z.record(z.string(), z.string()),
  }),
]);

export type ArcaSyncRunResult = z.infer<typeof SyncResultSchema>;

/** The last run: requested from the tray, started, finished and its result.
 *  A run is pending while it was requested or started after it finished. */
export type ArcaSyncRun = {
  requestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  result: ArcaSyncRunResult | null;
};

export type ArcaWebAccountStatus = {
  state: ArcaWebAccountState;
  cuit: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  sync: ArcaSyncRun;
};

const NO_SYNC: ArcaSyncRun = {
  requestedAt: null,
  startedAt: null,
  finishedAt: null,
  result: null,
};

/** The single reader of the ARCA web account: its state, never the clave.
 *  Null when the read failed. */
export async function getArcaWebAccountStatus(
  supabase: Supabase,
): Promise<ArcaWebAccountStatus | null> {
  const { data, error } = await supabase
    .from("arca_web_account")
    .select(
      "cuit, status, secret_id, last_success_at, last_error_code, sync_requested_at, sync_started_at, sync_finished_at, sync_result",
    )
    .maybeSingle();
  if (error) return null;
  const parsedResult = SyncResultSchema.safeParse(data?.sync_result);
  const sync: ArcaSyncRun = data
    ? {
        requestedAt: data.sync_requested_at ?? null,
        startedAt: data.sync_started_at ?? null,
        finishedAt: data.sync_finished_at ?? null,
        result: parsedResult.success ? parsedResult.data : null,
      }
    : NO_SYNC;
  if (!data || data.secret_id === null) {
    return {
      state: "missing",
      cuit: data?.cuit ?? null,
      lastSuccessAt: null,
      lastErrorCode: null,
      sync,
    };
  }
  return {
    state: data.status === "sign_in_failing" ? "rejected" : "ok",
    cuit: data.cuit,
    lastSuccessAt: data.last_success_at,
    lastErrorCode: data.last_error_code,
    sync,
  };
}

/** The clave fiscal, for the job step that signs in (service role only).
 *  Null when not configured, rejected by ARCA, or the read failed. */
export async function readArcaWebPassword(
  supabase: Supabase,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_arca_web_password");
  if (error || typeof data !== "string" || data === "") return null;
  return data;
}
