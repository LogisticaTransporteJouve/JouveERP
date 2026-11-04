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
    currency: "ARS",
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

  it("flags a fixed monthly fee loaded twice in one month, and only that pair", () => {
    const monthly = Array.from({ length: 12 }, (_, i) =>
      row({
        id: `m${i + 1}`,
        numero: i + 1,
        fecha: `2026-${String(i + 1).padStart(2, "0")}-01`,
      }),
    );
    const twice = row({ id: "dup", numero: 99, fecha: "2026-03-03" });
    const f = detectDuplicateInvoices([...monthly, twice]);
    expect(f).toHaveLength(1);
    expect(f[0]?.source_refs).toEqual(["m3", "dup"]);
    expect(f[0]?.metrics.count).toBe(2);
    expect(f[0]?.finding).toMatch(/2 facturas por \$1\.000 con ≤2 día\(s\)/);
  });

  it("does not flag a fixed monthly or weekly fee with no duplicate", () => {
    const monthly = Array.from({ length: 12 }, (_, i) =>
      row({
        id: `m${i + 1}`,
        numero: i + 1,
        fecha: `2026-${String(i + 1).padStart(2, "0")}-01`,
      }),
    );
    const weekly = Array.from({ length: 10 }, (_, i) =>
      row({
        id: `w${i + 1}`,
        supplier_id: "s2",
        numero: i + 1,
        fecha: new Date(Date.UTC(2026, 0, 5 + 7 * i))
          .toISOString()
          .slice(0, 10),
      }),
    );
    expect(detectDuplicateInvoices([...monthly, ...weekly])).toEqual([]);
  });

  it("flags three loads of one invoice on consecutive days", () => {
    const f = detectDuplicateInvoices([
      row({ id: "a", numero: 10, fecha: "2026-06-01" }),
      row({ id: "b", numero: 11, fecha: "2026-06-02" }),
      row({ id: "c", numero: 12, fecha: "2026-06-03" }),
    ]);
    expect(f.map((x) => x.source_refs)).toEqual([["a", "b", "c"]]);
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

  it("never measures a peso invoice against a dollar history", () => {
    const usd = [1800, 1900, 2000, 2100, 2200].map((amt, i) =>
      row({ id: `u${i}`, imp_total: amt, numero: i + 1, currency: "USD" }),
    );
    const ars = row({ id: "ars", imp_total: 2_400_000, numero: 99 });
    expect(detectUnusualAmounts([...usd, ars])).toHaveLength(0);
  });

  it("prints a dollar outlier and its range in dollars", () => {
    const usd = [100, 110, 120, 130, 140].map((amt, i) =>
      row({ id: `u${i}`, imp_total: amt, numero: i + 1, currency: "USD" }),
    );
    const spike = row({
      id: "spike",
      imp_total: 5000,
      numero: 99,
      currency: "USD",
    });
    const [f] = detectUnusualAmounts([...usd, spike]);
    expect(f?.finding).toContain("por US$5.000");
    expect(f?.finding).toMatch(/rango habitual \(US\$\d+–US\$\d+\)/);
    expect(f?.metrics).toMatchObject({ currency: "USD" });
  });
});

describe("currency split in duplicates", () => {
  it("never pairs a peso and a dollar invoice with the same figure", () => {
    const f = detectDuplicateInvoices([
      row({ id: "a", numero: 10, fecha: "2026-06-01" }),
      row({ id: "b", numero: 11, fecha: "2026-06-15", currency: "USD" }),
    ]);
    expect(f).toHaveLength(0);
  });
});
