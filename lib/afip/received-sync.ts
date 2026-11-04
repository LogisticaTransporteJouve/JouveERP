import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";

import {
  getArcaWebAccountStatus,
  readArcaWebPassword,
} from "./arca-web-account";
import {
  ArcaRobotError,
  signInToMisComprobantes,
  type ArcaRobot,
  type ArcaRobotErrorCode,
} from "./mis-comprobantes/robot";
import { ingestReceivedVouchers, type IngestCounts } from "./received-vouchers";

type Supabase = SupabaseClient<Database>;

export type ReceivedSyncResult =
  | {
      outcome: "skipped";
      reason: "not_configured" | "rejected" | "read_failed";
    }
  /** The run threw before it could say more (a bug or an outage of ours). */
  | { outcome: "failed"; code: "UNEXPECTED" }
  | { outcome: "sign_in_failed"; code: ArcaRobotErrorCode | "RECORD_FAILED" }
  | {
      outcome: "done";
      counts: IngestCounts;
      skippedRows: number;
      /** Months whose query failed (YYYY-MM → code); the rest were read. */
      failedMonths: Record<string, MonthFailure>;
    };

/** Why a month was not read: its own error, the run's time budget, or an
 *  earlier month's error that stopped the run (NOT_READ). */
export type MonthFailure =
  ArcaRobotErrorCode | "INGEST_FAILED" | "TIME_BUDGET" | "NOT_READ";

export type SignIn = typeof signInToMisComprobantes;

/** Time a run may take from its start before it stops querying months, well
 *  inside the Inngest route's 300 s limit (the last month's query and ingest
 *  come on top). */
const RUN_BUDGET_MS = 200_000;

type SyncDeps = {
  representedCuit: string;
  signIn?: SignIn;
  now?: () => number;
};

/** The calendar months between from and to (YYYY-MM-DD), as [from, to]
 *  ranges clipped to the bounds. */
export function monthRanges(from: string, to: string): [string, string][] {
  const out: [string, string][] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  for (;;) {
    const first = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const last = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    if (first > to) break;
    out.push([first < from ? from : first, last > to ? to : last]);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

const SIGN_IN_CODES: readonly ArcaRobotErrorCode[] = [
  "SIGN_IN_REJECTED",
  "SIGN_IN_FAILED",
  "SERVICE_NOT_AUTHORIZED",
  "REPRESENTED_NOT_FOUND",
  "NETWORK",
];

class RecordFailedError extends Error {}

/** Records a sign-in against the credentials the run read. A save in
 *  between makes it a no-op. A failure that could not be recorded throws:
 *  the next run would send a clave ARCA may have refused. */
async function recordAttempt(
  supabase: Supabase,
  version: string,
  ok: boolean,
  code: string | null,
) {
  const { data, error } = await supabase.rpc("record_arca_web_attempt", {
    p_ok: ok,
    p_error_code: code ?? "",
    p_version: version,
  });
  if (error) {
    logger.error("arca_received_sync.record_failed", { code: error.code, ok });
    if (!ok) throw new RecordFailedError(error.code);
    return;
  }
  if (data === false) {
    logger.info("arca_received_sync.record_stale", { ok });
  }
}

/** Stamps the run on the account row so the tray can follow it; a failed
 *  write is logged and the run goes on. */
async function markSync(
  supabase: Supabase,
  fields:
    | { sync_started_at: string }
    | { sync_finished_at: string; sync_result: ReceivedSyncResult },
) {
  const { error } = await supabase
    .from("arca_web_account")
    .update(fields)
    .eq("id", true);
  if (error) {
    logger.error("arca_received_sync.mark_failed", { code: error.code });
  }
}

/** Signs in to ARCA with the stored user, reads Recibidos month by month and
 *  adds what is new to the tray, stamping when the run started and how it
 *  ended. A clave ARCA rejected is not retried: the account stays
 *  «rechazada» until someone saves a new one. The clave never leaves this
 *  module. */
export async function runReceivedSync(
  supabase: Supabase,
  range: { from: string; to: string },
  deps: SyncDeps,
): Promise<ReceivedSyncResult> {
  const startedAt = (deps.now ?? Date.now)();
  await markSync(supabase, { sync_started_at: new Date().toISOString() });
  let result: ReceivedSyncResult;
  try {
    result = await syncReceived(supabase, range, deps, startedAt);
  } catch (err) {
    // Whatever stopped the run, the tray learns it ended: a run left
    // "started" would read as still running, then as the previous result.
    result =
      err instanceof RecordFailedError
        ? { outcome: "sign_in_failed", code: "RECORD_FAILED" }
        : { outcome: "failed", code: "UNEXPECTED" };
    await markSync(supabase, {
      sync_finished_at: new Date().toISOString(),
      sync_result: result,
    });
    // Loud on purpose: the run shows as failed in Inngest.
    throw err;
  }
  await markSync(supabase, {
    sync_finished_at: new Date().toISOString(),
    sync_result: result,
  });
  return result;
}

async function syncReceived(
  supabase: Supabase,
  range: { from: string; to: string },
  deps: SyncDeps,
  startedAt: number,
): Promise<ReceivedSyncResult> {
  const status = await getArcaWebAccountStatus(supabase);
  if (!status) return { outcome: "skipped", reason: "read_failed" };
  if (status.state === "missing" || !status.cuit || !status.version) {
    return { outcome: "skipped", reason: "not_configured" };
  }
  const version = status.version;
  if (status.state === "rejected") {
    return { outcome: "skipped", reason: "rejected" };
  }
  // The account is active here, so no clave means Vault did not answer.
  const password = await readArcaWebPassword(supabase);
  if (!password) return { outcome: "skipped", reason: "read_failed" };

  let robot: ArcaRobot;
  try {
    robot = await (deps.signIn ?? signInToMisComprobantes)({
      cuit: status.cuit,
      password,
      representedCuit: deps.representedCuit,
    });
  } catch (err) {
    const code =
      err instanceof ArcaRobotError && SIGN_IN_CODES.includes(err.code)
        ? err.code
        : "SIGN_IN_FAILED";
    // Only ARCA judging the clave can lock the user, so only a failure there
    // counts toward the stop; a refused CUIT will not change by retrying.
    // ARCA down or a captcha before the clave leaves the account as it is,
    // and a failure after ARCA accepted the clave (portal, Mis Comprobantes)
    // proves the clave good.
    const stage = err instanceof ArcaRobotError ? err.stage : "before_clave";
    if (code === "SIGN_IN_REJECTED" || stage === "clave") {
      await recordAttempt(supabase, version, false, code);
    } else if (stage === "after_clave") {
      await recordAttempt(supabase, version, true, null);
    }
    logger.warn("arca_received_sync.sign_in_failed", { code, stage });
    return { outcome: "sign_in_failed", code };
  }
  await recordAttempt(supabase, version, true, null);

  const counts: IngestCounts = {
    inserted: 0,
    unsupported: 0,
    alreadyInTray: 0,
    linked: 0,
  };
  let skippedRows = 0;
  const failedMonths: Record<string, MonthFailure> = {};
  // From the start of the run: a slow sign-in eats the same 300 s.
  const deadline = startedAt + RUN_BUDGET_MS;
  let stopped = false;
  for (const [from, to] of monthRanges(range.from, range.to)) {
    const month = from.slice(0, 7);
    // Months left unread are reported, not dropped: the next run or another
    // «Traer de ARCA» picks them up.
    if (stopped) {
      failedMonths[month] = "NOT_READ";
      continue;
    }
    if ((deps.now ?? Date.now)() > deadline) {
      failedMonths[month] = "TIME_BUDGET";
      continue;
    }
    let parsed;
    try {
      parsed = await robot.queryReceived(from, to);
    } catch (err) {
      const code =
        err instanceof ArcaRobotError ? err.code : ("QUERY_FAILED" as const);
      failedMonths[month] = code;
      logger.warn("arca_received_sync.month_failed", { month, code });
      // A lost connection would fail the next months the same way, so they
      // are reported as not read. A month ARCA answered badly is only that
      // month: the newer ones are still read.
      if (code === "NETWORK") stopped = true;
      continue;
    }
    skippedRows += Object.values(parsed.skippedByReason).reduce(
      (a, n) => a + (n ?? 0),
      0,
    );
    const ingested = await ingestReceivedVouchers(supabase, parsed.vouchers, {
      origin: "sync",
    });
    if (!ingested) {
      failedMonths[month] = "INGEST_FAILED";
      stopped = true;
      continue;
    }
    counts.inserted += ingested.inserted;
    counts.unsupported += ingested.unsupported;
    counts.alreadyInTray += ingested.alreadyInTray;
    counts.linked += ingested.linked;
  }
  logger.info("arca_received_sync.done", {
    ...counts,
    skippedRows,
    failedMonths: Object.keys(failedMonths).length,
  });
  return { outcome: "done", counts, skippedRows, failedMonths };
}
