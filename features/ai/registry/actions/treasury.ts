import { z } from "zod";

import { getTreasurySummaryAction } from "@/features/treasury/actions/treasury-actions";
import { TREASURY_PERMISSIONS } from "@/lib/auth/permissions";

import { defineAiAction } from "../define";
import { type AiRunResult, errResult, okResult } from "../result";

export async function runTreasurySummary(): Promise<AiRunResult> {
  const res = await getTreasurySummaryAction();
  if (!res.ok) return errResult(res.error);
  const d = res.data;
  return okResult(
    `Caja real (todos los canales): ${d.accounts.length} active accounts · ` +
      `${d.checks_due_soon.count} ARS checks in portfolio due soon (7 days; ` +
      `pesos only, USD portfolio in checks_usd_now).`,
    d,
    {
      note: "Tesorería es la caja real de todos los canales: no se separa por canal.",
    },
  );
}

export const getTreasurySummary = defineAiAction({
  name: "getTreasurySummary",
  domain: "tesoreria",
  permission: TREASURY_PERMISSIONS,
  sideEffect: "read",
  sources: ["accounts", "account_movement_totals", "checks"],
  description:
    "Treasury summary: balances per account and currency (ARS/USD), current " +
    "totals vs. end of previous month, and the ARS (pesos only) portfolio " +
    "checks due within 7 days. " +
    "No parameters. Useful for 'how's the cash doing?'.",
  input: z.object({}),
  run: () => runTreasurySummary(),
});
