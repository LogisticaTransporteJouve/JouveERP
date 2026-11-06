import { describe, expect, it } from "vitest";

import {
  ReconciliationPeriodSchema,
  groupByYear,
  groupIssues,
  periodRange,
  periodReconciled,
  sideDiff,
  type ReconciliationIssue,
  type ReconciliationMonth,
} from "./arca-reconciliation";

function month(
  m: string,
  over: Partial<ReconciliationMonth> = {},
): ReconciliationMonth {
  return {
    month: `${m}-01`,
    arca_count: 1,
    arca_uncomparable: 0,
    arca_neto: 100,
    arca_iva: 21,
    arca_trib: 0,
    arca_total: 121,
    erp_count: 1,
    erp_neto: 100,
    erp_iva: 21,
    erp_trib: 0,
    erp_total: 121,
    arca_only: 0,
    erp_only: 0,
    amount_mismatch: 0,
    ...over,
  };
}

describe("periodRange", () => {
  it("spans a whole year", () => {
    expect(periodRange("2026")).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });

  it("ends a month on its last day, leap years included", () => {
    expect(periodRange("2028-02")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
    expect(periodRange("2026-11")).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
    });
  });

  it("accepts only a year or a month", () => {
    expect(ReconciliationPeriodSchema.safeParse("2026-10").success).toBe(true);
    expect(ReconciliationPeriodSchema.safeParse("2026-13").success).toBe(false);
    expect(ReconciliationPeriodSchema.safeParse("2026-10-01").success).toBe(
      false,
    );
  });
});

describe("groupByYear", () => {
  it("sums the months of each year, newest year first", () => {
    const years = groupByYear([
      month("2025-12"),
      month("2026-11", { arca_count: 2, arca_total: 200.1, arca_only: 1 }),
      month("2026-10", { erp_total: 0.2 }),
    ]);
    expect(years.map((y) => y.period)).toEqual(["2026", "2025"]);
    const [y2026, y2025] = years;
    if (!y2026 || !y2025) throw new Error("two years expected");
    expect(y2026.months.map((m) => m.period)).toEqual(["2026-10", "2026-11"]);
    expect(y2026.arca.count).toBe(3);
    expect(y2026.arca.total).toBe(321.1);
    expect(y2026.erp.total).toBe(121.2);
    expect(y2026.arcaOnly).toBe(1);
    expect(periodReconciled(y2026)).toBe(false);
    expect(periodReconciled(y2025)).toBe(true);
  });
});

describe("sideDiff", () => {
  it("is null when both sides match to the cent", () => {
    expect(sideDiff(121, 121)).toBeNull();
    expect(sideDiff(0.1 + 0.2, 0.3)).toBeNull();
  });

  it("is ARCA minus ERP otherwise", () => {
    expect(sideDiff(121, 125)).toBe(-4);
    expect(sideDiff(10.01, 10)).toBe(0.01);
  });
});

describe("groupIssues", () => {
  const row = (
    issue: ReconciliationIssue["issue"],
    issue_count: number,
  ): ReconciliationIssue => ({
    issue,
    issue_count,
    voucher_id: null,
    voucher_status: null,
    purchase_invoice_id: "p",
    fecha: "2026-11-01",
    issuer_cuit: "20111111111",
    issuer_name: "Uno",
    cbte_tipo: null,
    kind: "factura",
    letter: "A",
    punto_venta: 1,
    numero: 1,
    arca_moneda: null,
    arca_total: null,
    erp_moneda: "PES",
    erp_total: 10,
  });

  it("splits the rows by list and keeps each list's full count", () => {
    const d = groupIssues([row("erp_only", 300), row("erp_only", 300)]);
    expect(d.erp_only.rows).toHaveLength(2);
    expect(d.erp_only.count).toBe(300);
    expect(d.arca_only).toEqual({ rows: [], count: 0 });
  });
});
