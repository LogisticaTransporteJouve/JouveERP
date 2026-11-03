import { describe, expect, it } from "vitest";

import {
  matchImportedLines,
  reconcile,
  type ImportedLine,
  type LedgerEntry,
  type StatementMovement,
} from "./match";

const mv = (
  p: Partial<StatementMovement> & { index: number },
): StatementMovement => ({
  date: "2026-06-10",
  concepto: "x",
  amount: 1000,
  direction: "in",
  ...p,
});
const led = (p: Partial<LedgerEntry> & { id: string }): LedgerEntry => ({
  date: "2026-06-10",
  amount: 1000,
  direction: "in",
  ...p,
});

describe("reconcile", () => {
  it("matches same direction + amount within date window", () => {
    const r = reconcile([mv({ index: 0 })], [led({ id: "L1" })]);
    expect(r.matched).toEqual([{ movementIndex: 0, ledgerId: "L1" }]);
    expect(r.unmatchedStatement).toHaveLength(0);
    expect(r.unmatchedLedger).toHaveLength(0);
  });

  it("does not match across opposite directions", () => {
    const r = reconcile(
      [mv({ index: 0, direction: "out" })],
      [led({ id: "L1", direction: "in" })],
    );
    expect(r.matched).toHaveLength(0);
    expect(r.unmatchedStatement).toHaveLength(1);
    expect(r.unmatchedLedger).toHaveLength(1);
  });

  it("rejects amounts beyond tolerance and dates beyond the window", () => {
    expect(
      reconcile(
        [mv({ index: 0, amount: 1000 })],
        [led({ id: "L1", amount: 1100 })],
      ).matched,
    ).toHaveLength(0);
    expect(
      reconcile(
        [mv({ index: 0, date: "2026-06-10" })],
        [led({ id: "L1", date: "2026-06-20" })],
      ).matched,
    ).toHaveLength(0);
  });

  it("is one-to-one greedy (closest date wins, each ledger used once)", () => {
    const r = reconcile(
      [
        mv({ index: 0, date: "2026-06-10" }),
        mv({ index: 1, date: "2026-06-11" }),
      ],
      [
        led({ id: "L1", date: "2026-06-10" }),
        led({ id: "L2", date: "2026-06-11" }),
      ],
    );
    expect(r.matched).toHaveLength(2);
    const ids = r.matched.map((m) => m.ledgerId).sort();
    expect(ids).toEqual(["L1", "L2"]);
  });
});

describe("matchImportedLines", () => {
  const imp = (p: Partial<ImportedLine> & { id: string }): ImportedLine => ({
    date: "2026-06-10",
    amount: 1000,
    status: "open",
    ...p,
  });

  it("finds a scanned movement among the imported lines by signed amount and date", () => {
    const out = matchImportedLines(
      [
        mv({ index: 0 }),
        mv({ index: 1, direction: "out", amount: 50 }),
        mv({ index: 2, date: "2026-06-20" }),
      ],
      [
        imp({ id: "A", status: "matched" }),
        imp({ id: "B", amount: -50, date: "2026-06-11" }),
        imp({ id: "C", amount: 50 }),
      ],
    );
    expect(out.get(0)?.id).toBe("A");
    // A debit matches the negative line, not the credit of the same size.
    expect(out.get(1)?.id).toBe("B");
    // Ten days off: not the same line.
    expect(out.has(2)).toBe(false);
  });

  it("uses each imported line once", () => {
    const out = matchImportedLines(
      [mv({ index: 0 }), mv({ index: 1 })],
      [imp({ id: "A" })],
    );
    expect(out.size).toBe(1);
  });
});
