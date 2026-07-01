import "server-only";

import { getServiceClient } from "@/lib/supabase/service";

import { reconcile, type LedgerEntry, type StatementMovement } from "./match";

export type ReconciliationSummary = {
  matched: number;
  unmatched_statement: number;
  unmatched_ledger: number;
  statement_total: number;
};

const DIRECTION: Record<string, "in" | "out"> = {
  income: "in",
  transfer_in: "in",
  expense: "out",
  transfer_out: "out",
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Reconciles an extracted bank statement against ARS cash movements in the
 * statement's date range (±5 days). Returns a compact summary for the review
 * screen, or null if the payload has no movements.
 */
export async function reconcileExtracto(
  payload: unknown,
): Promise<ReconciliationSummary | null> {
  if (!isRecord(payload) || !Array.isArray(payload.movements)) return null;

  const movements: StatementMovement[] = [];
  payload.movements.forEach((m, i) => {
    if (!isRecord(m)) return;
    const fecha = typeof m.date === "string" ? m.date : null;
    const concepto = typeof m.concept === "string" ? m.concept : "";
    const debito = typeof m.debit === "number" ? m.debit : 0;
    const credito = typeof m.credit === "number" ? m.credit : 0;
    if (credito > 0) {
      movements.push({ index: i, date: fecha, concepto, amount: credito, direction: "in" });
    } else if (debito > 0) {
      movements.push({ index: i, date: fecha, concepto, amount: debito, direction: "out" });
    }
  });
  if (movements.length === 0) return null;

  const dates = movements
    .map((m) => m.date)
    .filter((d): d is string => d !== null)
    .sort();
  const from = dates[0];
  const to = dates[dates.length - 1];

  const service = getServiceClient();
  let query = service
    .from("transactions")
    .select("id, kind, amount, transaction_date")
    .eq("currency", "ARS");
  if (from) query = query.gte("transaction_date", shift(from, -5));
  if (to) query = query.lte("transaction_date", shift(to, 5));
  const { data } = await query;

  const ledger: LedgerEntry[] = (data ?? []).map((t) => ({
    id: t.id,
    date: t.transaction_date,
    amount: Math.abs(Number(t.amount)),
    direction: DIRECTION[t.kind] ?? "out",
  }));

  const r = reconcile(movements, ledger);
  return {
    matched: r.matched.length,
    unmatched_statement: r.unmatchedStatement.length,
    unmatched_ledger: r.unmatchedLedger.length,
    statement_total: movements.length,
  };
}
