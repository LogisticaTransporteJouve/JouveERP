import "server-only";

import { logAudit } from "@/lib/actions/audit";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

/**
 * Credits a deposited check with the caller's session (RPC `credit_check`,
 * which refuses a check that is not depositado), then the audit. The caller
 * has already checked `cheques:write` + CHECK_CASH_PERMISSIONS: «Acreditar»
 * in Cheques and a deposit credited from a bank statement line.
 */
export async function creditCheck(
  actorId: string,
  data: { check_id: string; event_date: string; notes?: string | null },
): Promise<ActionResult<{ movement_id: string }>> {
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("credit_check", {
    p_check_id: data.check_id,
    p_event_date: data.event_date,
    p_notes: data.notes ?? "",
  });
  if (error) {
    const guard = mapDbGuardError(error, {
      slug: "cheques.credit.rejected",
      userId: actorId,
      id: data.check_id,
    });
    if (guard) return { ok: false, error: guard };
    logger.error("cheques.credit.failed", {
      userId: actorId,
      check_id: data.check_id,
      error,
    });
    return { ok: false, error: "No se pudo acreditar el cheque." };
  }
  await logAudit("check.credited", actorId, {}, data.check_id);
  return { ok: true, data: { movement_id: id as string } };
}
