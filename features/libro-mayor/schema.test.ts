import { describe, expect, it } from "vitest";

import { computeLedgerSummary, type LedgerRow } from "./schema";

const row = (over: Partial<LedgerRow>): LedgerRow => ({
  entry_id: "e",
  line_id: "l",
  entry_date: "2026-05-01",
  accrual_period: "2026-05",
  description: "",
  source_table: null,
  source_id: null,
  channel_id: null,
  is_reversal: false,
  debit: 0,
  credit: 0,
  line_desc: null,
  running: 0,
  ...over,
});

describe("computeLedgerSummary", () => {
  it("suma debit/credit y toma running de la última fila", () => {
    const s = computeLedgerSummary([
      row({ debit: 1000, running: 1000 }),
      row({ credit: 300, running: 700 }),
      row({ debit: 200, running: 900 }),
    ]);
    expect(s.totalDebit).toBe(1200);
    expect(s.totalCredit).toBe(300);
    expect(s.finalBalance).toBe(900);
  });

  it("devuelve cero balance si no hay filas", () => {
    const s = computeLedgerSummary([]);
    expect(s.finalBalance).toBe(0);
  });
});
