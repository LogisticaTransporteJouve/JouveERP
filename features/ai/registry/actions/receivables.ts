import { z } from "zod";

import { getAgingSummaryAction } from "@/features/aging/actions/aging-actions";

import { defineAiAction } from "../define";
import { type AiRunResult, agingResult, errResult } from "../result";

/** Wraps the existing read action; gating (`clients:read`) and RLS are
 *  inherited from the action — the tool adds no new data access. */
export async function runClientAging(): Promise<AiRunResult> {
  const res = await getAgingSummaryAction();
  if (!res.ok) return errResult(res.error);
  return agingResult(res.data, "clients");
}

export const getClientAging = defineAiAction({
  name: "getClientAging",
  domain: "ventas",
  permission: "clients:read",
  sideEffect: "read",
  sources: ["v_client_aging", "v_aging_documents"],
  description:
    "Accounts receivable aging: open balance of each client per bucket " +
    "(0-30 / 30-60 / 60-90 / +90 days), pesos and dollars separately, sorted " +
    "by highest debt (dollars at the latest official rate), with totals. " +
    "No parameters. Useful for 'who owes me the most?' or collection risk.",
  input: z.object({}),
  run: () => runClientAging(),
});
