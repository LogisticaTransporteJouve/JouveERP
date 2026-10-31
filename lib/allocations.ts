// Pure aggregation for current-account statements (clients ↔ receipts,
// suppliers ↔ payment orders). Shared by both sides so the "applied" and
// "a cuenta" math stays identical.

import { formatMoney, round2 } from "@/lib/format";

/** Currency of a current-account movement: pesos and dollars keep separate
 *  balances, never one sum. */
export type StatementCurrency = "ARS" | "USD";
export type CurrencyBalances = Record<StatementCurrency, number>;

export function zeroBalances(): CurrencyBalances {
  return { ARS: 0, USD: 0 };
}

export function roundBalances(b: CurrencyBalances): CurrencyBalances {
  return { ARS: round2(b.ARS), USD: round2(b.USD) };
}

export type AllocationInput = {
  /** The document the money was applied to (invoice / purchase invoice). */
  document_id: string | null;
  /** The payer document that made the allocation (receipt / payment order). */
  payer_id: string;
  amount_applied: number | string;
  /** Whether this allocation reduces the document's outstanding (e.g. false
   *  for allocations of a canceled receipt). Payer totals ignore this flag:
   *  only issued payers appear in the statement anyway. */
  counts_for_document: boolean;
};

export type OpeningAllocationInput = {
  document_id: string;
  amount_applied: number | string;
};

export type AllocationTotals = {
  /** Σ amount applied per document (counted allocations + opening allocations). */
  appliedByDocument: Map<string, number>;
  /** Σ amount allocated per payer document (all its allocations). */
  appliedByPayer: Map<string, number>;
};

function add(map: Map<string, number>, key: string, amount: number) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

export function sumAllocations(
  allocations: readonly AllocationInput[],
  openingAllocations: readonly OpeningAllocationInput[],
): AllocationTotals {
  const appliedByDocument = new Map<string, number>();
  const appliedByPayer = new Map<string, number>();
  for (const a of allocations) {
    const amount = Number(a.amount_applied);
    add(appliedByPayer, a.payer_id, amount);
    if (a.counts_for_document && a.document_id) {
      add(appliedByDocument, a.document_id, amount);
    }
  }
  for (const a of openingAllocations) {
    add(appliedByDocument, a.document_id, Number(a.amount_applied));
  }
  return { appliedByDocument, appliedByPayer };
}

/**
 * Reads `status` from a PostgREST to-one embed (`parent!inner ( status )`),
 * which arrives as an object or, depending on the inferred cardinality, a
 * one-element array. Returns null when absent.
 */
export function readEmbeddedStatus(embed: unknown): string | null {
  const one: unknown = Array.isArray(embed) ? embed[0] : embed;
  if (typeof one !== "object" || one === null || !("status" in one)) {
    return null;
  }
  return typeof one.status === "string" ? one.status : null;
}

export type PendingDocument = {
  id: string;
  fecha: string;
  outstanding: number;
};

export type DocumentAllocation = {
  document_id: string;
  amount_applied: number;
};

const CENT = 0.005;

/** Spreads `amount` over the pending documents, oldest `fecha` first (ties by
 *  id), each up to its outstanding, until the amount is used up. */
export function allocateFifo(
  pending: readonly PendingDocument[],
  amount: number,
): DocumentAllocation[] {
  const oldestFirst = [...pending].sort((a, b) =>
    a.fecha !== b.fecha ? (a.fecha < b.fecha ? -1 : 1) : a.id < b.id ? -1 : 1,
  );
  const out: DocumentAllocation[] = [];
  let remaining = round2(amount);
  for (const doc of oldestFirst) {
    if (remaining <= CENT) break;
    const applied = round2(Math.min(doc.outstanding, remaining));
    if (applied <= CENT) continue;
    out.push({ document_id: doc.id, amount_applied: applied });
    remaining = round2(remaining - applied);
  }
  return out;
}

/** Why a set of allocations can't be applied (Spanish, for the user), or null.
 *  Each document must be pending and receive at most its outstanding; the sum
 *  can't exceed the payer's total. */
export function allocationsIssue(
  pending: readonly PendingDocument[],
  allocations: readonly DocumentAllocation[],
  total: number,
): string | null {
  const outstanding = new Map(pending.map((d) => [d.id, d.outstanding]));
  const byDocument = new Map<string, number>();
  let sum = 0;
  for (const a of allocations) {
    byDocument.set(
      a.document_id,
      (byDocument.get(a.document_id) ?? 0) + a.amount_applied,
    );
    sum += a.amount_applied;
  }
  for (const [id, applied] of byDocument) {
    const open = outstanding.get(id);
    if (open === undefined) {
      return "Uno de los comprobantes imputados ya no tiene saldo pendiente.";
    }
    if (applied > open + 0.01) {
      return `La imputación (${formatMoney(applied)}) excede el saldo pendiente del comprobante (${formatMoney(open)}).`;
    }
  }
  if (sum > total + 0.01) {
    return "Las imputaciones superan el total.";
  }
  return null;
}
