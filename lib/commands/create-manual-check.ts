import "server-only";

import type { ManualChequeCreateInput } from "@/features/checks/schema";
import { logAudit } from "@/lib/actions/audit";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

/**
 * Loads a third-party check into a cartera by hand, with the caller's session:
 * the check, its cartera inflow and its 'received' anchor in one transaction
 * (RPC `create_manual_check`), then the audit. «Nuevo cheque» and the cheque
 * scan both write through here. The caller has already checked
 * `cheques:write` + CHECK_CASH_PERMISSIONS and parsed the input with
 * `ManualChequeCreateSchema`.
 */
export async function createManualCheck(
  actorId: string,
  input: ManualChequeCreateInput,
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("create_manual_check", {
    p_kind: input.kind,
    p_check_number: input.check_number,
    p_bank_name: input.bank_name,
    p_drawer_name: input.drawer_name,
    p_drawer_cuit: input.drawer_cuit ?? undefined,
    p_issue_date: input.issue_date,
    p_due_date: input.due_date,
    p_amount: input.amount,
    p_currency: input.currency,
    p_cartera_account_id: input.cartera_account_id,
    p_channel_id: input.channel_id,
    p_source_client_id: input.source_client_id ?? undefined,
    p_notes: input.notes ?? undefined,
  });

  if (error || !id) {
    if (error?.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: `Ya existe un cheque ${input.check_number} para ${input.bank_name}.`,
      };
    }
    const guard = mapDbGuardError(error, {
      slug: "cheques.create.rejected",
      userId: actorId,
    });
    if (guard) return { ok: false, error: guard };
    logger.error("cheques.create.failed", {
      userId: actorId,
      bank_name: input.bank_name,
      check_number: input.check_number,
      error,
    });
    return { ok: false, error: "No se pudo registrar el cheque." };
  }

  await logAudit(
    "check.created",
    actorId,
    {
      kind: input.kind,
      bank_name: input.bank_name,
      check_number: input.check_number,
      amount: input.amount,
      channel_id: input.channel_id,
    },
    id,
  );
  return { ok: true, data: { id } };
}
