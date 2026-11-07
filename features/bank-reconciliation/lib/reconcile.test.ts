import { describe, expect, it } from "vitest";

import type { BookMovement, StatementLine } from "../schema";
import {
  referenceTokens,
  suggestMatches,
  sumAmounts,
  summarize,
} from "./reconcile";

function line(p: Partial<StatementLine> & { id: string }): StatementLine {
  return {
    line_date: "2026-10-10",
    description: "Movimiento",
    amount: -100,
    balance: null,
    reference: null,
    bank_code: null,
    status: "open",
    ignore_reason: null,
    transaction_ids: [],
    ...p,
  };
}

function mov(p: Partial<BookMovement> & { id: string }): BookMovement {
  return {
    transaction_date: "2026-10-10",
    kind: "expense",
    signed_amount: -100,
    description: null,
    source_document: null,
    line_ids: [],
    ...p,
  };
}

describe("referenceTokens", () => {
  it("takes the reference and long numbers of the description", () => {
    expect(
      referenceTokens({
        reference: "TRF-889",
        description: "Transf 123456 x 12",
      }),
    ).toEqual(["trf-889", "123456"]);
  });
});

describe("suggestMatches", () => {
  it("pairs exact amounts within the window, closest date first", () => {
    const out = suggestMatches(
      [line({ id: "l1", amount: -100 })],
      [
        mov({ id: "far", transaction_date: "2026-10-14" }),
        mov({ id: "near", transaction_date: "2026-10-11" }),
        mov({ id: "other", signed_amount: -100.01 }),
        mov({ id: "out", transaction_date: "2026-10-30" }),
      ],
      5,
    );
    expect(out).toEqual([
      {
        line_id: "l1",
        transaction_id: "near",
        days: 1,
        reference_match: false,
      },
    ]);
  });

  it("prefers a reference match and uses each movement once", () => {
    const out = suggestMatches(
      [line({ id: "l1", reference: "OP-77" }), line({ id: "l2" })],
      [
        mov({
          id: "a",
          description: "Pago OP-77 proveedor",
          transaction_date: "2026-10-13",
        }),
        mov({ id: "b" }),
      ],
      5,
    );
    expect(out.map((s) => [s.line_id, s.transaction_id])).toEqual([
      ["l1", "a"],
      ["l2", "b"],
    ]);
  });

  it("skips lines not open, movements already reconciled and opposite signs", () => {
    const out = suggestMatches(
      [line({ id: "l1", status: "ignored" }), line({ id: "l2", amount: 100 })],
      [mov({ id: "a", line_ids: ["x"] }), mov({ id: "b" })],
      5,
    );
    expect(out).toEqual([]);
  });
});

describe("summarize", () => {
  it("compares the last statement balance with the book balance", () => {
    const s = summarize({
      lines: [
        line({ id: "1", amount: 500, balance: 1500, status: "matched" }),
        line({ id: "2", amount: -20.1, balance: 1479.9 }),
        line({ id: "3", amount: -5, status: "ignored", ignore_reason: "x" }),
      ],
      movements: [
        mov({ id: "a", signed_amount: 500, line_ids: ["1"] }),
        mov({ id: "b", signed_amount: -30 }),
        mov({ id: "c", signed_amount: -1, transaction_date: "2026-11-02" }),
      ],
      from: "2026-10-01",
      to: "2026-10-31",
      bookBalance: 1470,
      bookBalanceAtStatement: 1470,
    });
    expect(s).toMatchObject({
      statement_balance: 1479.9,
      book_balance: 1470,
      difference: 9.9,
      matched_count: 1,
      matched_total: 500,
      open_count: 1,
      open_total: -20.1,
      ignored_count: 1,
      unmatched_book_count: 1,
      unmatched_book_total: -30,
      unmatched_book_total_at_statement: -30,
    });
  });

  it("explains the difference only with book movements up to the statement balance", () => {
    const s = summarize({
      lines: [
        line({ id: "1", amount: 0, balance: 1000, line_date: "2026-10-28" }),
      ],
      movements: [
        mov({ id: "a", signed_amount: -20, transaction_date: "2026-10-20" }),
        mov({ id: "b", signed_amount: -50, transaction_date: "2026-10-30" }),
      ],
      from: "2026-10-01",
      to: "2026-10-31",
      bookBalance: 930,
      bookBalanceAtStatement: 980,
    });
    expect(s).toMatchObject({
      difference: 20,
      unmatched_book_total: -70,
      unmatched_book_total_at_statement: -20,
    });
  });

  it("has no difference without a statement balance", () => {
    const s = summarize({
      lines: [line({ id: "1" })],
      movements: [],
      from: "2026-10-01",
      to: "2026-10-31",
      bookBalance: 0,
      bookBalanceAtStatement: 0,
    });
    expect(s.statement_balance).toBeNull();
    expect(s.difference).toBeNull();
  });

  it("compares the statement balance with the books on the same date", () => {
    // The bank's last balance is on the 28th; the books moved -50 on the 30th.
    const s = summarize({
      lines: [
        line({
          id: "1",
          line_date: "2026-10-28",
          amount: 100,
          balance: 1000,
          status: "matched",
        }),
      ],
      movements: [
        mov({ id: "a", signed_amount: 100, line_ids: ["1"] }),
        mov({ id: "b", signed_amount: -50, transaction_date: "2026-10-30" }),
      ],
      from: "2026-10-01",
      to: "2026-10-31",
      bookBalance: 950,
      bookBalanceAtStatement: 1000,
    });
    expect(s).toMatchObject({
      statement_balance_date: "2026-10-28",
      book_balance: 950,
      difference: 0,
    });
  });
});

describe("sumAmounts", () => {
  it("adds to the cent without float drift", () => {
    expect(sumAmounts([0.1, 0.2, -0.3])).toBe(0);
  });
});
