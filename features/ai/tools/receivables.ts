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
    `${t.client_count} clientes con saldo · total ${money(t.total_open)} · ` +
      `+90 días ${money(t.bucket_90_plus)} (${t.document_count} comprobantes).`,
    res.data,
  );
}

export const getClientAging = tool({
  description:
    "Aging de cuentas por cobrar: saldo abierto de cada cliente por bucket " +
    "(0-30 / 30-60 / 60-90 / +90 días), ordenado por mayor deuda, con totales. " +
    "Sin parámetros. Útil para '¿quién me debe más?' o riesgo de cobranzas.",
  inputSchema: z.object({}),
  execute: () => runClientAging(),
});
