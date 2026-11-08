import "server-only";

import type { z } from "zod";

import type { DepositChequeSchema } from "@/features/checks/schema";
import { logAudit } from "@/lib/actions/audit";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

/**
 * Deposits a cartera check into a bank account with the caller's session:
 * the check leaves the cartera and the bank receives it in one transaction
 * (RPC `deposit_check`, which refuses a check no longer en cartera), then
 * the audit. The caller has already checked `cheques:write` +
 * CHECK_CASH_PERMISSIONS and parsed the input with `DepositChequeSchema`:
 * «Depositar» in Cheques, «Depositar cheque» on a bank statement line and
 * an accepted assistant proposal.
 */
export async function depositCheck(
  actorId: string,
  data: z.output<typeof DepositChequeSchema>,
): Promise<ActionResult<{ movement_id: string }>> {
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("deposit_check", {
    p_check_id: data.check_id,
    p_account_id: data.account_id,
    p_event_date: data.event_date,
    p_channel_id: data.channel_id,
    p_description: data.description ?? "",
  });

  if (error) {
    const guard = mapDbGuardError(error, {
      slug: "cheques.deposit.rejected",
      userId: actorId,
      id: data.check_id,
    });
    if (guard) return { ok: false, error: guard };
    logger.error("cheques.deposit.failed", {
      userId: actorId,
      check_id: data.check_id,
      error,
    });
    return { ok: false, error: "No se pudo depositar el cheque." };
  }

  await logAudit(
    "check.deposited",
    actorId,
    { destination_account_id: data.account_id },
    data.check_id,
  );
  return { ok: true, data: { movement_id: id as string } };
}
