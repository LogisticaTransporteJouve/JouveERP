import { z } from "zod";

import { getAgingSummaryAction } from "@/features/aging/actions/aging-actions";

import { CLIENT_AGING_PERMISSIONS } from "@/lib/auth/permissions";
import type { FiscalFilter } from "@/lib/scope";
import { ScopeInputSchema } from "@/lib/validation/common";

import { defineAiAction } from "../define";
import { type AiRunResult, agingResult, errResult } from "../result";
import { readScope } from "../scope";

/** Wraps the existing read action; gating (clients + invoices + receipts) and
 *  RLS are inherited from the action — the tool adds no new data access. */
export async function runClientAging(
  input: { scope?: FiscalFilter | null } = {},
): Promise<AiRunResult> {
  const { isFiscal, label } = readScope(input.scope);
  const res = await getAgingSummaryAction({ isFiscal });
  if (!res.ok) return errResult(res.error);
  return agingResult(res.data, "clients", label);
}

export const getClientAging = defineAiAction({
  name: "getClientAging",
  domain: "ventas",
  permission: CLIENT_AGING_PERMISSIONS,
  sideEffect: "read",
  sources: ["v_client_aging", "v_client_aging_by_scope", "v_aging_documents"],
  description:
    "Accounts receivable aging: open balance of each client per bucket " +
    "(0-30 / 30-60 / 60-90 / +90 days), pesos and dollars separately, sorted " +
    "by highest debt (dollars at the latest official rate), with totals. " +
    "Debt includes rejected checks of receipts (aged from the rejection), " +
    "reported apart as rejected_checks_*. " +
    "Optional scope (fiscal/internal/all). Useful for 'who owes me the most?' " +
    "or collection risk.",
  input: z.object({ scope: ScopeInputSchema }),
  run: (_ctx, input) => runClientAging(input),
});
