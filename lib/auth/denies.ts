import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PG_UNDEFINED_TABLE,
  POSTGREST_TABLE_NOT_FOUND,
} from "@/lib/db/pg-error-codes";
import type { Database } from "@/lib/db/database.types";
import { captureException, captureMessageOnce } from "@/lib/observability";

/**
 * The permissions denied to each of `userIds` (user_permission_denies), raw:
 * resolveAccess turns them into an Access. `permissions` narrows the read to
 * those rows, which keeps a fan-out over many users under PostgREST's row cap.
 *
 * Fails closed on any error but one: Vercel serves new code before the
 * migration that creates the table is approved, and until then no deny can
 * exist, so a missing table reads as "no denies". Remove that branch once
 * 20261028140000_user_permission_denies is in production.
 */
export async function loadDenies(
  client: SupabaseClient<Database>,
  userIds: readonly string[],
  permissions?: readonly string[],
): Promise<Map<string, string[]>> {
  const denies = new Map<string, string[]>();
  if (userIds.length === 0) return denies;
  let query = client
    .from("user_permission_denies")
    .select("user_id, permission")
    .in("user_id", [...userIds]);
  if (permissions) query = query.in("permission", [...permissions]);
  const { data, error } = await query;
  if (error) {
    if (
      error.code === PG_UNDEFINED_TABLE ||
      error.code === POSTGREST_TABLE_NOT_FOUND
    ) {
      captureMessageOnce("auth.denies.table_missing", "warn", {
        code: error.code,
      });
      return denies;
    }
    captureException(error, {
      op: "auth.denies.load_failed",
      count: userIds.length,
    });
    throw error;
  }
  for (const row of data ?? []) {
    denies.set(row.user_id, [
      ...(denies.get(row.user_id) ?? []),
      row.permission,
    ]);
  }
  return denies;
}
