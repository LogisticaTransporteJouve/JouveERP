import { describe, expect, it } from "vitest";

import { expandRecurringPayment, projectCashFlow } from "./cashflow";

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

describe("expandRecurringPayment", () => {
  it("expands a monthly payment across the horizon", () => {
    const events = expandRecurringPayment({
      nextDueDate: "2026-07-05",
      frequency: "monthly",
      endDate: null,
      amount: 1000,
      fromDate: "2026-07-01",
      toDate: "2026-10-01",
      label: "alquiler",
    });
    expect(events.map((e) => e.date)).toEqual([
      "2026-07-05",
      "2026-08-05",
      "2026-09-05",
    ]);
    expect(events.every((e) => e.amount === -1000)).toBe(true);
  });

  it("advances a past next_due_date forward and respects end_date", () => {
    const events = expandRecurringPayment({
      nextDueDate: "2026-01-10",
      frequency: "monthly",
      endDate: "2026-08-31",
      amount: 500,
      fromDate: "2026-07-01",
      toDate: "2026-12-01",
      label: "préstamo",
    });
    // Catches up to July/Aug only (end_date stops Sep+).
    expect(events.map((e) => e.date)).toEqual(["2026-07-10", "2026-08-10"]);
  });

  it("expands weekly payments", () => {
    const events = expandRecurringPayment({
      nextDueDate: "2026-07-01",
      frequency: "weekly",
      endDate: null,
      amount: 100,
      fromDate: "2026-07-01",
      toDate: "2026-07-22",
      label: "x",
    });
    expect(events).toHaveLength(3);
  });
});
