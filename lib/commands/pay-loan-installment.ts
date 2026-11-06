import "server-only";

import type { z } from "zod";

import type { PayInstallmentSchema } from "@/features/loans/schema";
import { logAudit } from "@/lib/actions/audit";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

/**
 * "Pagar cuota" of a loan, with the caller's session: one transaction (RPC
 * `pay_loan_installment`) claims the pending installment (FOR UPDATE, so a
 * cuota already paid is refused), books the outflow on the loan's channel
 * and closes the loan after the last one; then the audit. The caller has
 * already checked LOAN_CASH_PERMISSIONS (accounting:write +
 * transactions:write) and parsed the input with `PayInstallmentSchema`:
 * the loan page and an accepted assistant proposal.
 */
export async function payLoanInstallment(
  actorId: string,
  input: z.output<typeof PayInstallmentSchema>,
): Promise<ActionResult<{ transactionId: string }>> {
  const { id, paid_date, account_id, amount } = input;
  const supabase = await createClient();
  const { data: transactionId, error } = await supabase.rpc(
    "pay_loan_installment",
    {
      p_installment_id: id,
      p_paid_date: paid_date,
      p_account_id: account_id,
      p_amount: amount,
    },
  );
  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "loans.installment.pay.rejected",
      userId: actorId,
      id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("loans.installment.pay.failed", {
      userId: actorId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo registrar el pago de la cuota." };
  }

  await logAudit(
    "loan.installment_paid",
    actorId,
    { installment_id: id, amount },
    transactionId,
  );
  return { ok: true, data: { transactionId } };
}
