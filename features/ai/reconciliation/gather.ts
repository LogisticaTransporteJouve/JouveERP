import "server-only";

import { logger } from "@/lib/logger";
import { paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import {
  matchImportedLines,
  reconcile,
  type ImportedLine,
  type LedgerEntry,
  type StatementMovement,
} from "./match";

export type ReconciliationSummary = {
  /** Movements explained: reconciled in Conciliación, or matching a movement
   *  of the books that no imported line explains yet. */
  matched: number;
  unmatched_statement: number;
  unmatched_ledger: number;
  statement_total: number;
  /** Movements that are lines of a statement already imported
   *  (bank_statement_lines): Conciliación decides them. */
  imported: number;
  /** Of those, still pending in Conciliación. */
  imported_open: number;
};

const DIRECTION: Record<string, "in" | "out"> = {
  income: "in",
  transfer_in: "in",
  expense: "out",
  transfer_out: "out",
};

/** Rows one summary reads of each table; past this it gives no summary
 *  rather than a partial one. */
const MAX_ROWS = 5_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isLineStatus(v: unknown): v is ImportedLine["status"] {
  return v === "open" || v === "matched" || v === "ignored";
}

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Reconciles an extracted bank statement. A movement that is a line of a
 * statement already imported (ARS accounts, same signed amount, ±1 day)
 * takes that line's state in Conciliación: reconciled there, ignored, or
 * still pending. The rest is matched against the ARS cash movements of the
 * period (±5 days) not reconciled with an imported line. Returns a compact
 * summary for the review screen, or null if the payload has no movements or
 * a read failed (a partial answer would misstate it).
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
      movements.push({
        index: i,
        date: fecha,
        concepto,
        amount: credito,
        direction: "in",
      });
    } else if (debito > 0) {
      movements.push({
        index: i,
        date: fecha,
        concepto,
        amount: debito,
        direction: "out",
      });
    }
  });
  if (movements.length === 0) return null;

  const dates = movements
    .map((m) => m.date)
    .filter((d): d is string => d !== null)
    .sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  const from = first ? shift(first, -5) : null;
  const to = last ? shift(last, 5) : null;

  const service = getServiceClient();
  const [lineRes, txRes] = await Promise.all([
    paginateRange(
      (f, t) => {
        let q = service
          .from("bank_statement_lines")
          .select("id, line_date, amount, status, accounts!inner ( currency )")
          .eq("accounts.currency", "ARS");
        if (from) q = q.gte("line_date", from);
        if (to) q = q.lte("line_date", to);
        return q.order("id").range(f, t);
      },
      undefined,
      MAX_ROWS,
    ),
    paginateRange(
      (f, t) => {
        let q = service
          .from("transactions")
          .select(
            "id, kind, amount, transaction_date, bank_statement_matches ( line_id )",
          )
          .eq("currency", "ARS");
        if (from) q = q.gte("transaction_date", from);
        if (to) q = q.lte("transaction_date", to);
        return q.order("id").range(f, t);
      },
      undefined,
      MAX_ROWS,
    ),
  ]);
  if (lineRes.error || txRes.error) {
    logger.warn("ai.reconciliation.read_failed", {
      error: lineRes.error ?? txRes.error,
    });
    return null;
  }

  const lines: ImportedLine[] = lineRes.data.flatMap((l) =>
    isLineStatus(l.status)
      ? [
          {
            id: l.id,
            date: l.line_date,
            amount: Number(l.amount),
            status: l.status,
          },
        ]
      : [],
  );
  const imported = matchImportedLines(movements, lines);
  const reconciledThere = [...imported.values()].filter(
    (l) => l.status !== "open",
  ).length;
  const importedOpen = imported.size - reconciledThere;

  // A movement reconciled with an imported line is explained by it.
  const ledger: LedgerEntry[] = txRes.data
    .filter((t) => (t.bank_statement_matches ?? []).length === 0)
    .map((t) => ({
      id: t.id,
      date: t.transaction_date,
      amount: Math.abs(Number(t.amount)),
      direction: DIRECTION[t.kind] ?? "out",
    }));
  const rest = movements.filter((m) => {
    const line = imported.get(m.index);
    return !line || line.status === "open";
  });
  const r = reconcile(rest, ledger);
  return {
    matched: reconciledThere + r.matched.length,
    unmatched_statement: r.unmatchedStatement.length,
    unmatched_ledger: r.unmatchedLedger.length,
    statement_total: movements.length,
    imported: imported.size,
    imported_open: importedOpen,
  };
}
