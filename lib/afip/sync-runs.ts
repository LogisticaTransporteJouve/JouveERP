import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";

// Bookkeeping for the ARCA import runs (`arca_sync_runs`): the job opens a
// row when it starts and closes it when it ends, so the UI can tell whether
// an import is running across reloads and devices.

type Supabase = SupabaseClient<Database>;

/** A run with no end older than this is taken as dead (crashed without its
 *  failure handler); it no longer blocks the button. */
export const STALE_RUN_MS = 2 * 60 * 60 * 1000;

export interface ArcaSyncStatus {
  running: { startedAt: string } | null;
  last: { finishedAt: string; imported: number; error: string | null } | null;
}

export async function openSyncRun(
  supabase: Supabase,
  trigger: "cron" | "manual",
  requestedBy: string | null,
): Promise<string> {
  const { data, error } = await supabase
    .from("arca_sync_runs")
    .insert({ trigger, requested_by: requestedBy })
    .select("id")
    .single();
  if (error) throw new Error(`open sync run: ${error.message}`);
  return data.id;
}

export async function closeSyncRun(
  supabase: Supabase,
  id: string,
  imported: number,
): Promise<void> {
  const { error } = await supabase
    .from("arca_sync_runs")
    .update({ finished_at: new Date().toISOString(), imported })
    .eq("id", id);
  if (error) throw new Error(`close sync run: ${error.message}`);
}

/** Closes whatever run is still open with the failure (one run at a time). */
export async function failOpenSyncRuns(
  supabase: Supabase,
  message: string,
): Promise<void> {
  const { error } = await supabase
    .from("arca_sync_runs")
    .update({ finished_at: new Date().toISOString(), error: message })
    .is("finished_at", null);
  if (error) throw new Error(`fail sync run: ${error.message}`);
}

export async function getSyncStatus(
  supabase: Supabase,
  now = Date.now(),
): Promise<ArcaSyncStatus> {
  const [open, done] = await Promise.all([
    supabase
      .from("arca_sync_runs")
      .select("started_at")
      .is("finished_at", null)
      .gte("started_at", new Date(now - STALE_RUN_MS).toISOString())
      .order("started_at", { ascending: false })
      .limit(1),
    supabase
      .from("arca_sync_runs")
      .select("finished_at, imported, error")
      .not("finished_at", "is", null)
      .order("finished_at", { ascending: false })
      .limit(1),
  ]);
  if (open.error) throw new Error(`sync status: ${open.error.message}`);
  if (done.error) throw new Error(`sync status: ${done.error.message}`);
  const run = open.data?.[0];
  const last = done.data?.[0];
  return {
    running: run ? { startedAt: run.started_at } : null,
    last:
      last?.finished_at != null
        ? {
            finishedAt: last.finished_at,
            imported: last.imported,
            error: last.error,
          }
        : null,
  };
}
