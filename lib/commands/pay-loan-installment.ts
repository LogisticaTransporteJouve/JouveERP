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
 * the loan page, a bank line and an accepted assistant proposal. A USD cuota
 * paid from a peso account carries `account_amount` (the pesos that leave the
 * account) and goes to the 5-arg signature; any other call keeps the 4-arg one.
 */
export async function payLoanInstallment(
  actorId: string,
  input: z.output<typeof PayInstallmentSchema>,
): Promise<ActionResult<{ transactionId: string }>> {
  const { id, paid_date, account_id, amount } = input;
  const accountAmount = input.account_amount ?? null;
  const supabase = await createClient();
  const args = {
    p_installment_id: id,
    p_paid_date: paid_date,
    p_account_id: account_id,
    p_amount: amount,
  };
  const { data: transactionId, error } =
    accountAmount === null
      ? await supabase.rpc("pay_loan_installment", args)
      : await supabase.rpc("pay_loan_installment", {
          ...args,
          p_account_amount: accountAmount,
        });
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
    accountAmount === null
      ? { installment_id: id, amount }
      : { installment_id: id, amount, account_amount: accountAmount },
    transactionId,
  );
  return { ok: true, data: { transactionId } };
}
