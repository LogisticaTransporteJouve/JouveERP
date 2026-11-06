import "server-only";

import {
  PAYMENT_ORDER_LINK_ERROR,
  type IssuedCheckCreateInput,
} from "@/features/issued-checks/schema";
import { logAudit } from "@/lib/actions/audit";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

/**
 * Loads a check of our own (Cheques propios › Nuevo) with the caller's
 * session, then audits it. A payment order's check is inserted by the order
 * itself, as one of its lines, so a link to one is refused. The caller has
 * already checked `issued_checks:write` and parsed the input with
 * `IssuedCheckCreateSchema`: the page's form and an accepted assistant
 * proposal.
 */
export async function createIssuedCheck(
  actorId: string,
  data: IssuedCheckCreateInput,
): Promise<ActionResult<{ id: string }>> {
  // A payment order's check is inserted by the order itself, as one of its
  // lines; a check linked afterwards would never move the bank when cashed.
  if (data.payment_order_id) {
    return { ok: false, error: PAYMENT_ORDER_LINK_ERROR };
  }

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("issued_checks")
    .insert({
      kind: data.kind,
      check_number: data.check_number,
      bank_name: data.bank_name,
      beneficiary_name: data.beneficiary_name ?? null,
      beneficiary_cuit: data.beneficiary_cuit ?? null,
      issue_date: data.issue_date,
      due_date: data.due_date,
      amount: data.amount,
      currency: data.currency,
      bank_account_id: data.bank_account_id,
      channel_id: data.channel_id,
      supplier_id: data.supplier_id ?? null,
      notes: data.notes ?? null,
      created_by: actorId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "Ya cargaste un cheque con ese número del mismo banco.",
      };
    }
    const guardError = mapDbGuardError(error, {
      slug: "issued_checks.create.rejected",
      userId: actorId,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("issued_checks.create.failed", { userId: actorId, error });
    return { ok: false, error: "No se pudo cargar el cheque." };
  }

  await logAudit(
    "issued_check.created",
    actorId,
    {
      check_number: data.check_number,
      amount: data.amount,
    },
    row.id,
  );
  return { ok: true, data: { id: row.id } };
}
