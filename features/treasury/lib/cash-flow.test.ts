import { describe, expect, it } from "vitest";

import { buildCashFlow, type CashFlowEvent } from "./cash-flow";

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
