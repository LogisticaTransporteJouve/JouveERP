import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import { monthRanges } from "@/lib/date-range";
import { round2 } from "@/lib/format";
import { logger } from "@/lib/logger";
import { paginateRange } from "@/lib/supabase/paginate";
import { normalizePlate } from "@/lib/validation/plate";

import {
  StrixError,
  signInToStrix,
  type StrixErrorCode,
  type StrixRobot,
} from "./robot";
import { getStrixAccountStatus, readStrixPassword } from "./strix-account";

type Supabase = SupabaseClient<Database>;

export type StrixMonthFailure = StrixErrorCode | "SAVE_FAILED" | "NOT_READ";

export type StrixSyncResult =
  | {
      outcome: "skipped";
      reason: "not_configured" | "rejected" | "read_failed";
    }
  /** UNEXPECTED: a bug or an outage of ours. The rest: Strix could not
   *  list its vehicles. */
  | { outcome: "failed"; code: "UNEXPECTED" | StrixErrorCode }
  | { outcome: "sign_in_failed"; code: StrixErrorCode | "RECORD_FAILED" }
  | {
      outcome: "done";
      from: string;
      to: string;
      /** Vehicle-days saved. */
      days: number;
      /** Vehicles with at least one day saved. */
      vehicles: number;
      /** Strix patentes with no vehicle in JouveERP: their km are not kept. */
      unmatched: string[];
      /** Months whose report failed (YYYY-MM → code); the rest were read. */
      failedMonths: Record<string, StrixMonthFailure>;
    };

export type SignIn = typeof signInToStrix;

type SyncDeps = { signIn?: SignIn };

const UPSERT_CHUNK = 500;

class RecordFailedError extends Error {}

/** Records a sign-in against the credentials the run read; a save in between
 *  makes it a no-op. A failure that could not be recorded throws: the next
 *  run would send a password Strix may have refused. */
async function recordAttempt(
  supabase: Supabase,
  version: string,
  ok: boolean,
  code: string | null,
) {
  const { error } = await supabase.rpc("record_strix_attempt", {
    p_ok: ok,
    p_error_code: code ?? "",
    p_version: version,
  });
  if (error) {
    logger.error("strix_km_sync.record_failed", { code: error.code, ok });
    if (!ok) throw new RecordFailedError(error.code);
  }
}

async function markSync(
  supabase: Supabase,
  fields:
    | { sync_started_at: string }
    | { sync_finished_at: string; sync_result: StrixSyncResult },
) {
  const { error } = await supabase
    .from("strix_account")
    .update(fields)
    .eq("id", true);
  if (error) logger.error("strix_km_sync.mark_failed", { code: error.code });
}

/** Signs in to Strix with the stored user, reads the km driven per vehicle
 *  and day month by month, and saves them (a day read again is
 *  overwritten), stamping when the run started and how it ended. The
 *  password never leaves this module. */
export async function runStrixKmSync(
  supabase: Supabase,
  range: { from: string; to: string },
  deps: SyncDeps = {},
): Promise<StrixSyncResult> {
  await markSync(supabase, { sync_started_at: new Date().toISOString() });
  let result: StrixSyncResult;
  try {
    result = await syncKm(supabase, range, deps);
  } catch (err) {
    result =
      err instanceof RecordFailedError
        ? { outcome: "sign_in_failed", code: "RECORD_FAILED" }
        : { outcome: "failed", code: "UNEXPECTED" };
    await markSync(supabase, {
      sync_finished_at: new Date().toISOString(),
      sync_result: result,
    });
    throw err;
  }
  await markSync(supabase, {
    sync_finished_at: new Date().toISOString(),
    sync_result: result,
  });
  return result;
}

async function syncKm(
  supabase: Supabase,
  range: { from: string; to: string },
  deps: SyncDeps,
): Promise<StrixSyncResult> {
  const status = await getStrixAccountStatus(supabase);
  if (!status) return { outcome: "skipped", reason: "read_failed" };
  if (status.state === "missing" || !status.username || !status.version) {
    return { outcome: "skipped", reason: "not_configured" };
  }
  if (status.state === "rejected") {
    return { outcome: "skipped", reason: "rejected" };
  }
  const version = status.version;
  const password = await readStrixPassword(supabase);
  if (!password) return { outcome: "skipped", reason: "read_failed" };

  let robot: StrixRobot;
  try {
    robot = await (deps.signIn ?? signInToStrix)({
      username: status.username,
      password,
    });
  } catch (err) {
    const code = err instanceof StrixError ? err.code : "SIGN_IN_FAILED";
    // Only Strix judging the password counts toward the stop; a network
    // failure leaves the account as it is.
    if (code === "SIGN_IN_REJECTED" || code === "SIGN_IN_FAILED") {
      await recordAttempt(supabase, version, false, code);
    }
    logger.warn("strix_km_sync.sign_in_failed", { code });
    return { outcome: "sign_in_failed", code };
  }
  await recordAttempt(supabase, version, true, null);

  const vehicles = await paginateRange((from, to) =>
    supabase.from("vehicles").select("id, patente").order("id").range(from, to),
  );
  if (vehicles.error) {
    logger.error("strix_km_sync.vehicles_failed", {
      code: vehicles.error.code,
    });
    return { outcome: "failed", code: "UNEXPECTED" };
  }
  const byPlate = new Map(
    vehicles.data.map((v) => [normalizePlate(v.patente), v.id]),
  );

  let entities;
  try {
    entities = await robot.vehicles();
  } catch (err) {
    const code = err instanceof StrixError ? err.code : "REPORT_FAILED";
    logger.warn("strix_km_sync.vehicles_list_failed", { code });
    return { outcome: "failed", code };
  }
  if (entities.length === 0) return { outcome: "failed", code: "NO_VEHICLES" };

  const unmatched = new Set<string>();
  const savedVehicles = new Set<string>();
  const failedMonths: Record<string, StrixMonthFailure> = {};
  let days = 0;
  let stopped = false;
  for (const [from, to] of monthRanges(range.from, range.to)) {
    const month = from.slice(0, 7);
    if (stopped) {
      failedMonths[month] = "NOT_READ";
      continue;
    }
    let rows;
    try {
      rows = await robot.kmDriven(from, to, entities);
    } catch (err) {
      const code = err instanceof StrixError ? err.code : "REPORT_FAILED";
      failedMonths[month] = code;
      logger.warn("strix_km_sync.month_failed", {
        month,
        code,
        detail: err instanceof Error ? err.message.slice(0, 200) : null,
      });
      if (code === "NETWORK") stopped = true;
      continue;
    }
    // One row per vehicle and day: Strix could repeat a day, the sum is
    // the km of that day.
    const perDay = new Map<
      string,
      { vehicle_id: string; day: string; km: number }
    >();
    for (const r of rows) {
      const vehicleId = byPlate.get(normalizePlate(r.domain));
      if (!vehicleId) {
        unmatched.add(r.domain);
        continue;
      }
      const key = `${vehicleId}|${r.day}`;
      const prev = perDay.get(key);
      perDay.set(key, {
        vehicle_id: vehicleId,
        day: r.day,
        km: round2((prev?.km ?? 0) + r.km),
      });
    }
    const upserts = [...perDay.values()].map((r) => ({
      ...r,
      km: Math.round(r.km * 10) / 10,
      synced_at: new Date().toISOString(),
    }));
    let saveFailed = false;
    for (let i = 0; i < upserts.length; i += UPSERT_CHUNK) {
      const { error } = await supabase
        .from("vehicle_km_daily")
        .upsert(upserts.slice(i, i + UPSERT_CHUNK), {
          onConflict: "vehicle_id,day",
        });
      if (error) {
        logger.error("strix_km_sync.save_failed", { month, code: error.code });
        saveFailed = true;
        break;
      }
    }
    if (saveFailed) {
      failedMonths[month] = "SAVE_FAILED";
      stopped = true;
      continue;
    }
    days += upserts.length;
    for (const u of upserts) savedVehicles.add(u.vehicle_id);
  }

  logger.info("strix_km_sync.done", {
    days,
    vehicles: savedVehicles.size,
    unmatched: unmatched.size,
    failedMonths: Object.keys(failedMonths).length,
  });
  return {
    outcome: "done",
    from: range.from,
    to: range.to,
    days,
    vehicles: savedVehicles.size,
    unmatched: [...unmatched].sort(),
    failedMonths,
  };
}
