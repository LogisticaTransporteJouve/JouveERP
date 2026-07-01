import { tool } from "ai";
import { z } from "zod";

import { getAgingSummaryAction } from "@/features/aging/actions/aging-actions";

import { type AiToolResult, errResult, money, okResult } from "./result";

/** Wraps the existing read action; gating (`clients:read`) and RLS are
 *  inherited from the action — the tool adds no new data access. */
export async function runClientAging(): Promise<AiToolResult> {
  const res = await getAgingSummaryAction();
  if (!res.ok) return errResult(res.error);
  const t = res.data.totals;
  return okResult(
    `${t.client_count} clients with balance · total ${money(t.total_open)} · ` +
      `+90 days ${money(t.bucket_90_plus)} (${t.document_count} documents).`,
    res.data,
  );
}

export const getClientAging = tool({
  description:
    "Accounts receivable aging: open balance of each client per bucket " +
    "(0-30 / 30-60 / 60-90 / +90 days), sorted by highest debt, with totals. " +
    "No parameters. Useful for 'who owes me the most?' or collection risk.",
  inputSchema: z.object({}),
  execute: () => runClientAging(),
});
