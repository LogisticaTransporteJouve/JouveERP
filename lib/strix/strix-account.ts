import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

type Supabase = SupabaseClient<Database>;

export type StrixAccountState = "missing" | "ok" | "rejected";

/** The stored result of a Strix run (StrixSyncResult in km-sync.ts), read
 *  back loosely: codes stay strings. */
const SyncResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("skipped"), reason: z.string() }),
  z.object({ outcome: z.literal("sign_in_failed"), code: z.string() }),
  z.object({ outcome: z.literal("failed"), code: z.string() }),
  z.object({
    outcome: z.literal("done"),
    from: z.string(),
    to: z.string(),
    days: z.number(),
    vehicles: z.number(),
    unmatched: z.array(z.string()),
    failedMonths: z.record(z.string(), z.string()),
  }),
]);

export type StrixSyncRunResult = z.infer<typeof SyncResultSchema>;

export type StrixSyncRun = {
  requestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  result: StrixSyncRunResult | null;
};

export type StrixAccountStatus = {
  state: StrixAccountState;
  username: string | null;
  /** Moves on every save: the version a sign-in result is recorded against. */
  version: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  sync: StrixSyncRun;
};

/** The single reader of the Strix account: its state, never the password.
 *  Null when the read failed. */
export async function getStrixAccountStatus(
  supabase: Supabase,
): Promise<StrixAccountStatus | null> {
  const { data, error } = await supabase
    .from("strix_account")
    .select(
      "username, status, secret_id, updated_at, last_success_at, last_error_code, sync_requested_at, sync_started_at, sync_finished_at, sync_result",
    )
    .maybeSingle();
  if (error) return null;
  const parsed = SyncResultSchema.safeParse(data?.sync_result);
  const sync: StrixSyncRun = {
    requestedAt: data?.sync_requested_at ?? null,
    startedAt: data?.sync_started_at ?? null,
    finishedAt: data?.sync_finished_at ?? null,
    result: parsed.success ? parsed.data : null,
  };
  if (!data || data.secret_id === null) {
    return {
      state: "missing",
      username: data?.username ?? null,
      version: data?.updated_at ?? null,
      lastSuccessAt: null,
      lastErrorCode: null,
      sync,
    };
  }
  return {
    state: data.status === "sign_in_failing" ? "rejected" : "ok",
    username: data.username,
    version: data.updated_at,
    lastSuccessAt: data.last_success_at,
    lastErrorCode: data.last_error_code,
    sync,
  };
}

/** The password, for the job step that signs in (service role only). Null
 *  when not configured, stopped, or the read failed. */
export async function readStrixPassword(
  supabase: Supabase,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_strix_password");
  if (error || typeof data !== "string" || data === "") return null;
  return data;
}
