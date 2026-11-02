import { describe, expect, it } from "vitest";

import {
  addMonths,
  buildCashFlow,
  placementMonth,
  projectionEndExclusive,
  type CashFlowEvent,
} from "./cash-flow";

const months = [
  { month: "2026-05", realized: true },
  { month: "2026-06", realized: true },
  { month: "2026-07", realized: false },
  { month: "2026-08", realized: false },
];

describe("buildCashFlow", () => {
  it("splits each month by facturado / interno and totals", () => {
    const events: CashFlowEvent[] = [
      { month: "2026-06", direction: "in", amount: 1000, scope: "facturado" },
      { month: "2026-06", direction: "in", amount: 400, scope: "interno" },
      { month: "2026-06", direction: "out", amount: 300, scope: "interno" },
    ];
    const r = buildCashFlow({ months, events, cashToday: 5000 });
    const jun = r.months.find((m) => m.month === "2026-06")!;
    expect(jun.inTotal).toBe(1400);
    expect(jun.inFacturado).toBe(1000);
    expect(jun.inInterno).toBe(400);
    expect(jun.outTotal).toBe(300);
    expect(jun.net).toBe(1100);
    // realized month → no projected running balance
    expect(jun.closing).toBeNull();
  });

  it("rolls the projected balance forward from cashToday", () => {
    const events: CashFlowEvent[] = [
      { month: "2026-07", direction: "in", amount: 2000, scope: "facturado" },
      { month: "2026-07", direction: "out", amount: 500, scope: "interno" },
      { month: "2026-08", direction: "out", amount: 1000, scope: "facturado" },
    ];
    const r = buildCashFlow({ months, events, cashToday: 5000 });
    const jul = r.months.find((m) => m.month === "2026-07")!;
    const ago = r.months.find((m) => m.month === "2026-08")!;
    expect(jul.closing).toBe(6500); // 5000 + (2000 - 500)
    expect(ago.closing).toBe(5500); // 6500 - 1000
    expect(r.lowestClosing).toBe(5500);
    expect(r.deficitMonth).toBeNull();
  });

  it("placementMonth uses the due month, clamps overdue forward", () => {
    // future due date → its own month
    expect(placementMonth("2026-09-15", "2026-08-01", "2026-07")).toBe(
      "2026-09",
    );
    // overdue (due before first projected) → first projected month
    expect(placementMonth("2026-05-20", "2026-04-01", "2026-07")).toBe(
      "2026-07",
    );
    // no due date → falls back to the invoice month
    expect(placementMonth(null, "2026-08-10", "2026-07")).toBe("2026-08");
    // nothing → first projected month
    expect(placementMonth(null, null, "2026-07")).toBe("2026-07");
  });

  it("flags the first projected month the balance goes negative", () => {
    const events: CashFlowEvent[] = [
      { month: "2026-07", direction: "out", amount: 6000, scope: "interno" },
    ];
    const r = buildCashFlow({ months, events, cashToday: 5000 });
    expect(r.months.find((m) => m.month === "2026-07")!.closing).toBe(-1000);
    expect(r.deficitMonth).toBe("2026-07");
    expect(r.lowestClosing).toBe(-1000);
  });
});

describe("addMonths", () => {
  it("rolls across year boundaries both ways", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-11", 0)).toBe("2026-11");
  });
});

describe("projectionEndExclusive", () => {
  const isValidIsoDate = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso;

  it("ends after a 30-day month without inventing a 31st", () => {
    // Dec 2026 + 6 months = June 2027 (30 days): `2027-06-31` broke Postgres.
    const end = projectionEndExclusive("2026-12", 6);
    expect(end).toBe("2027-07-01");
    expect(isValidIsoDate(end)).toBe(true);
    expect("2027-06-30" < end).toBe(true);
    expect("2027-07-01" < end).toBe(false);
  });

  it("ends after February, leap year or not", () => {
    expect(projectionEndExclusive("2026-08", 6)).toBe("2027-03-01");
    expect("2027-02-28" < projectionEndExclusive("2026-08", 6)).toBe(true);
    expect(projectionEndExclusive("2027-08", 6)).toBe("2028-03-01");
    expect("2028-02-29" < projectionEndExclusive("2027-08", 6)).toBe(true);
  });

  it("is a valid date for every horizon month", () => {
    for (let fwd = 1; fwd <= 24; fwd++) {
      expect(isValidIsoDate(projectionEndExclusive("2026-11", fwd))).toBe(true);
    }
  });
});
