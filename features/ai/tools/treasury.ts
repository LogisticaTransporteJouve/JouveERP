import { tool } from "ai";
import { z } from "zod";

import { getTreasurySummaryAction } from "@/features/treasury/actions/treasury-actions";

import { type AiToolResult, errResult, okResult } from "./result";

export async function runTreasurySummary(): Promise<AiToolResult> {
  const res = await getTreasurySummaryAction();
  if (!res.ok) return errResult(res.error);
  const d = res.data;
  return okResult(
    `${d.accounts.length} active accounts · ${d.checks_due_soon.count} checks ` +
      `due soon (7 days).`,
    d,
  );
}

export const getTreasurySummary = tool({
  description:
    "Treasury summary: balances per account and currency (ARS/USD), current " +
    "totals vs. end of previous month, and portfolio checks due soon. " +
    "No parameters. Useful for 'how's the cash doing?'.",
  inputSchema: z.object({}),
  execute: () => runTreasurySummary(),
});
