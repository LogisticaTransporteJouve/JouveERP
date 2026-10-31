import { describe, expect, it } from "vitest";

import {
  detectDuplicateInvoices,
  detectUnusualAmounts,
  type PurchaseRow,
} from "./detect";
import { outlierBounds, quartiles } from "./statistics";

function row(p: Partial<PurchaseRow> & { id: string }): PurchaseRow {
  return {
    scope: "fiscal",
    supplier_id: "s1",
    supplier_name: "Proveedor SA",
    imp_total: 1000,
    fecha: "2026-06-01",
    numero: 1,
    punto_venta: 1,
    ...p,
  };
}

describe("statistics", () => {
  it("quartiles interpolate", () => {
    const { q1, q3 } = quartiles([1, 2, 3, 4, 5]);
    expect(q1).toBe(2);
    expect(q3).toBe(4);
  });
  it("outlierBounds null below minSamples", () => {
    expect(outlierBounds([1, 2, 3], 5)).toBeNull();
  });
});

describe("detectDuplicateInvoices", () => {
  it("flags same supplier + same amount, distinct vouchers, within window", () => {
    const f = detectDuplicateInvoices([
      row({ id: "a", numero: 10, fecha: "2026-06-01" }),
      row({ id: "b", numero: 11, fecha: "2026-06-15" }),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]?.source_refs).toEqual(["a", "b"]);
  });

  it("does not flag when amounts differ", () => {
    const f = detectDuplicateInvoices([
      row({ id: "a", imp_total: 1000 }),
      row({ id: "b", imp_total: 2000, numero: 11 }),
    ]);
    expect(f).toHaveLength(0);
  });

  it("never pairs a fiscal invoice with an internal one", () => {
    const f = detectDuplicateInvoices([
      row({ id: "a", numero: 10, fecha: "2026-06-01" }),
      row({ id: "b", numero: 11, fecha: "2026-06-15", scope: "internal" }),
    ]);
    expect(f).toHaveLength(0);
  });

  it("labels the finding with its scope", () => {
    const f = detectDuplicateInvoices([
      row({ id: "a", numero: 10, scope: "internal" }),
      row({ id: "b", numero: 11, scope: "internal" }),
    ]);
    expect(f[0]?.finding).toMatch(/^Solo interno · /);
    expect(f[0]?.metrics.scope).toBe("internal");
  });

  it("does not flag when outside the 30-day window", () => {
    const f = detectDuplicateInvoices([
      row({ id: "a", fecha: "2026-06-01", numero: 10 }),
      row({ id: "b", fecha: "2026-08-01", numero: 11 }),
    ]);
    expect(f).toHaveLength(0);
  });
});

describe("detectUnusualAmounts", () => {
  it("flags a total far above the supplier's usual range", () => {
    const base = [100, 110, 120, 130, 140].map((amt, i) =>
      row({ id: `n${i}`, imp_total: amt, numero: i + 1 }),
    );
    const spike = row({ id: "spike", imp_total: 5000, numero: 99 });
    const f = detectUnusualAmounts([...base, spike]);
    expect(f.map((x) => x.source_refs[0])).toContain("spike");
  });

  it("measures each scope's range on its own", () => {
    const fiscal = [100, 110, 120, 130, 140].map((amt, i) =>
      row({ id: `f${i}`, imp_total: amt, numero: i + 1 }),
    );
    const internal = row({
      id: "i",
      imp_total: 5000,
      numero: 99,
      scope: "internal",
    });
    expect(detectUnusualAmounts([...fiscal, internal])).toHaveLength(0);
  });

  it("stays silent without enough history", () => {
    const f = detectUnusualAmounts([
      row({ id: "a", imp_total: 100 }),
      row({ id: "b", imp_total: 9999, numero: 2 }),
    ]);
    expect(f).toHaveLength(0);
  });
});
