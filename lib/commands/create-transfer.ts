import "server-only";

import type { TransferCreateInput } from "@/features/transactions/schema";
import { logAudit } from "@/lib/actions/audit";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

/**
 * Moves money between two treasury accounts with the caller's session: both
 * legs in one transaction (RPC `create_transfer`), then the audit. The caller
 * has already checked `transactions:write` and parsed the input with
 * `TransferCreateSchema`: the Caja form and an accepted assistant proposal.
 */
export async function createTransfer(
  actorId: string,
  data: TransferCreateInput,
): Promise<ActionResult<{ transfer_out_id: string; transfer_in_id: string }>> {
  const supabase = await createClient();
  const { data: rows, error } = await supabase.rpc("create_transfer", {
    p_account_from_id: data.account_from_id,
    p_account_to_id: data.account_to_id,
    p_channel_id: data.channel_id,
    p_amount: data.amount,
    p_currency: data.currency,
    p_transaction_date: data.transaction_date,
    p_accrual_month: data.accrual_month,
    p_description: data.description ?? "",
  });

  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "transactions.create_transfer.rejected",
      userId: actorId,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("transactions.create_transfer.failed", {
      userId: actorId,
      error,
    });
    return { ok: false, error: "No se pudo registrar la transferencia." };
  }

  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) {
    return { ok: false, error: "El RPC create_transfer no devolvió ids." };
  }

  await logAudit(
    "transaction.transfer_created",
    actorId,
    {
      from: data.account_from_id,
      to: data.account_to_id,
      amount: data.amount,
      channel_id: data.channel_id,
    },
    row.transfer_out_id,
  );

  return {
    ok: true,
    data: {
      transfer_out_id: row.transfer_out_id as string,
      transfer_in_id: row.transfer_in_id as string,
    },
  };
}
