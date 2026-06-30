import { describe, expect, it } from "vitest";

import {
  reconcile,
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
      reconcile([mv({ index: 0, amount: 1000 })], [led({ id: "L1", amount: 1100 })])
        .matched,
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
      [mv({ index: 0, date: "2026-06-10" }), mv({ index: 1, date: "2026-06-11" })],
      [led({ id: "L1", date: "2026-06-10" }), led({ id: "L2", date: "2026-06-11" })],
    );
    expect(r.matched).toHaveLength(2);
    const ids = r.matched.map((m) => m.ledgerId).sort();
    expect(ids).toEqual(["L1", "L2"]);
  });
});
