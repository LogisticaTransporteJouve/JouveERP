// Pure aggregation for current-account statements (clients ↔ receipts,
// suppliers ↔ payment orders). Shared by both sides so the "applied" and
// "a cuenta" math stays identical.

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
