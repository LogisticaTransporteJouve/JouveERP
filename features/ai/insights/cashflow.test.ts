import { describe, expect, it } from "vitest";

import { projectCashFlow } from "./cashflow";

describe("projectCashFlow", () => {
  it("runs a positive balance forward with no events", () => {
    const p = projectCashFlow({
      startingBalance: 1000,
      events: [],
      fromDate: "2026-07-01",
      weeks: 4,
    });
    expect(p.weeks).toHaveLength(4);
    expect(p.weeks[3]?.closing).toBe(1000);
    expect(p.deficit).toBeNull();
    expect(p.lowestClosing).toBe(1000);
  });

  it("detects the first week the balance goes negative", () => {
    const p = projectCashFlow({
      startingBalance: 500,
      events: [
        { date: "2026-07-02", amount: -300, label: "alquiler" },
        { date: "2026-07-10", amount: -400, label: "cheque" }, // week 2 → closing -200
        { date: "2026-07-20", amount: 1000, label: "cobranza" },
      ],
      fromDate: "2026-07-01",
      weeks: 4,
    });
    expect(p.weeks[0]?.closing).toBe(200);
    expect(p.weeks[1]?.closing).toBe(-200);
    expect(p.deficit?.weekStart).toBe("2026-07-08");
    expect(p.deficit?.closing).toBe(-200);
    expect(p.lowestClosing).toBe(-200);
  });

  it("ignores events outside the horizon and sums in/out", () => {
    const p = projectCashFlow({
      startingBalance: 0,
      events: [
        { date: "2026-06-15", amount: -999, label: "antes" },
        { date: "2026-07-03", amount: 200, label: "in" },
        { date: "2026-07-03", amount: -50, label: "out" },
        { date: "2026-09-01", amount: -999, label: "después" },
      ],
      fromDate: "2026-07-01",
      weeks: 4,
    });
    expect(p.totalIn).toBe(200);
    expect(p.totalOut).toBe(-50);
    expect(p.weeks[0]?.closing).toBe(150);
  });
});
