import { tool } from "ai";
import { z } from "zod";

import { getTreasurySummaryAction } from "@/features/treasury/actions/treasury-actions";

import { type AiToolResult, errResult, okResult } from "./result";

export async function runTreasurySummary(): Promise<AiToolResult> {
  const res = await getTreasurySummaryAction();
  if (!res.ok) return errResult(res.error);
  const d = res.data;
  return okResult(
    `${d.accounts.length} cuentas activas · ${d.checks_due_soon.count} cheques ` +
      `por vencer (7 días).`,
    d,
  );
}

export const getTreasurySummary = tool({
  description:
    "Resumen de tesorería: saldos por cuenta y moneda (ARS/USD), totales " +
    "actuales vs. fin del mes anterior, y cheques en cartera por vencer. " +
    "Sin parámetros. Útil para '¿cómo viene la caja?'.",
  inputSchema: z.object({}),
  execute: () => runTreasurySummary(),
});
