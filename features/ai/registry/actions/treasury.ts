import { z } from "zod";

import { getTreasurySummaryAction } from "@/features/treasury/actions/treasury-actions";

import { defineAiAction } from "../define";
import { type AiRunResult, errResult, okResult } from "../result";

export async function runTreasurySummary(): Promise<AiRunResult> {
  const res = await getTreasurySummaryAction();
  if (!res.ok) return errResult(res.error);
  const d = res.data;
  return okResult(
    `Caja real (todos los canales): ${d.accounts.length} active accounts · ` +
      `${d.checks_due_soon.count} checks due soon (7 days).`,
    d,
    {
      note: "Treasury is the real cash of every channel; it is never split by scope.",
    },
  );
}

export const getTreasurySummary = defineAiAction({
  name: "getTreasurySummary",
  domain: "tesoreria",
  permission: "accounting:read",
  sideEffect: "read",
  sources: ["accounts", "account_movement_totals", "checks"],
  description:
    "Treasury summary: balances per account and currency (ARS/USD), current " +
    "totals vs. end of previous month, and portfolio checks due soon. " +
    "No parameters. Useful for 'how's the cash doing?'.",
  input: z.object({}),
  run: () => runTreasurySummary(),
});
