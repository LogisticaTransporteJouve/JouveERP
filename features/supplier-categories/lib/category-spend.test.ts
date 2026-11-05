import { describe, expect, it } from "vitest";

import { summarizeCategorySpend } from "./category-spend";

const row = (
  period: string,
  dim_id: string,
  dim_label: string,
  documents: number,
  net_ars: number,
) => ({ period, dim_id, dim_label, documents, net_ars });

describe("summarizeCategorySpend", () => {
  it("totals the months and adds up each supplier across months", () => {
    const spend = summarizeCategorySpend(
      [
        row("2026-02", "cat", "Combustible", 2, 300.1),
        row("2026-01", "cat", "Combustible", 3, 0.2),
      ],
      [
        row("2026-01", "s1", "YPF", 2, 100.1),
        row("2026-01", "s2", "Shell", 1, -99.9),
        row("2026-02", "s1", "YPF", 1, 200.1),
        row("2026-02", "s2", "Shell", 1, 100),
      ],
    );
    expect(spend.net).toBe(300.3);
    expect(spend.documents).toBe(5);
    expect(spend.months.map((m) => m.period)).toEqual(["2026-01", "2026-02"]);
    expect(spend.suppliers).toEqual([
      { supplierId: "s1", legalName: "YPF", documents: 3, net: 300.2 },
      { supplierId: "s2", legalName: "Shell", documents: 2, net: 0.1 },
    ]);
    expect(spend.suppliersPartial).toBe(false);
  });

  it("keeps a net that NCs turned negative", () => {
    const spend = summarizeCategorySpend(
      [row("2026-03", "cat", "Combustible", 1, -50)],
      [row("2026-03", "s1", "YPF", 1, -50)],
    );
    expect(spend.net).toBe(-50);
    expect(spend.suppliers[0]?.net).toBe(-50);
  });

  it("flags the supplier table when its rows hit the cap", () => {
    const rows = [
      row("2026-01", "s1", "YPF", 1, 1),
      row("2026-02", "s1", "YPF", 1, 1),
    ];
    expect(summarizeCategorySpend([], rows, 2).suppliersPartial).toBe(true);
    expect(summarizeCategorySpend([], rows, 3).suppliersPartial).toBe(false);
  });

  it("reads no rows as zero spend", () => {
    expect(summarizeCategorySpend([], [])).toEqual({
      net: 0,
      documents: 0,
      months: [],
      suppliers: [],
      suppliersPartial: false,
    });
  });
});
