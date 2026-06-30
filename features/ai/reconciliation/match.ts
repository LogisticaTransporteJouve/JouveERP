// Deterministic bank-statement reconciliation (pure, no DB/LLM). Matches each
// statement movement to a ledger cash movement by direction + amount (± a small
// tolerance) + date proximity (± a day window), one-to-one and greedy.

export type StatementMovement = {
  index: number; // position in the statement
  date: string | null; // YYYY-MM-DD
  concepto: string;
  amount: number; // positive
  direction: "in" | "out"; // credito = in, debito = out
};

export type LedgerEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number; // positive
  direction: "in" | "out"; // income/transfer_in = in, expense/transfer_out = out
};

export type ReconResult = {
  matched: { movementIndex: number; ledgerId: string }[];
  unmatchedStatement: StatementMovement[];
  unmatchedLedger: LedgerEntry[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function dayNum(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

export function reconcile(
  movements: StatementMovement[],
  ledger: LedgerEntry[],
  opts: { amountTolerance?: number; dayWindow?: number } = {},
): ReconResult {
  const amountTolerance = opts.amountTolerance ?? 0.5;
  const dayWindow = opts.dayWindow ?? 3;

  const usedLedger = new Set<string>();
  const matched: { movementIndex: number; ledgerId: string }[] = [];
  const unmatchedStatement: StatementMovement[] = [];

  // Process movements in date order for stable greedy matching.
  const ordered = [...movements].sort(
    (a, b) => (a.date ? dayNum(a.date) : 0) - (b.date ? dayNum(b.date) : 0),
  );

  for (const mv of ordered) {
    let best: { entry: LedgerEntry; dist: number } | null = null;
    for (const entry of ledger) {
      if (usedLedger.has(entry.id)) continue;
      if (entry.direction !== mv.direction) continue;
      if (Math.abs(entry.amount - mv.amount) > amountTolerance) continue;
      const dist = mv.date
        ? Math.abs(dayNum(entry.date) - dayNum(mv.date))
        : 0;
      if (dist > dayWindow) continue;
      if (best === null || dist < best.dist) best = { entry, dist };
    }
    if (best) {
      usedLedger.add(best.entry.id);
      matched.push({ movementIndex: mv.index, ledgerId: best.entry.id });
    } else {
      unmatchedStatement.push(mv);
    }
  }

  const unmatchedLedger = ledger.filter((e) => !usedLedger.has(e.id));
  return { matched, unmatchedStatement, unmatchedLedger };
}
