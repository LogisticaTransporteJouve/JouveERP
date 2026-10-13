import { describe, expect, it } from "vitest";

import { buildCashFlow } from "./cash-flow";
import {
  indexMovementTotals,
  isCashScope,
  monthlyFlowsToEvents,
} from "./movement-totals";

describe("indexMovementTotals", () => {
  it("indexes numeric strings by account", () => {
    const m = indexMovementTotals([
      {
        account_id: "a",
        net_until: "1500.25",
        net_until_split: "-20",
        last_movement_date: "2026-07-01",
      },
      {
        account_id: "b",
        net_until: 0,
        net_until_split: 0,
        last_movement_date: null,
      },
    ]);
    expect(m.get("a")).toEqual({
      netUntil: 1500.25,
      netUntilSplit: -20,
      lastMovementDate: "2026-07-01",
    });
    expect(m.get("b")?.lastMovementDate).toBeNull();
    expect(m.has("c")).toBe(false);
  });
});

describe("monthlyFlowsToEvents", () => {
  const accountCurrency = new Map([
    ["ars", "ARS"],
    ["usd", "USD"],
  ]);
  const toArs = (amount: number, currency: string) =>
    currency === "USD" ? amount * 1000 : amount;
  const monthSet = new Set(["2026-06", "2026-07"]);

  it("maps kind → direction, keeps scope, converts USD, filters", () => {
    const events = monthlyFlowsToEvents(
      [
        {
          account_id: "ars",
          month: "2026-06",
          kind: "income",
          scope: "facturado",
          total: "100.10",
        },
        {
          account_id: "ars",
          month: "2026-07",
          kind: "expense",
          scope: "interno",
          total: 40,
        },
        {
          account_id: "usd",
          month: "2026-07",
          kind: "income",
          scope: "otro",
          total: 2,
        },
        // account excluded by the caller (e.g. USD without a rate)
        {
          account_id: "gone",
          month: "2026-07",
          kind: "income",
          scope: "facturado",
          total: 999,
        },
        // month outside the chart
        {
          account_id: "ars",
          month: "2026-01",
          kind: "income",
          scope: "facturado",
          total: 5,
        },
        // transfers never are realized flows
        {
          account_id: "ars",
          month: "2026-07",
          kind: "transfer_in",
          scope: "facturado",
          total: 7,
        },
        // unknown scope degrades to "otro"
        {
          account_id: "ars",
          month: "2026-07",
          kind: "expense",
          scope: "weird",
          total: 1,
        },
      ],
      { accountCurrency, toArs, monthSet },
    );
    expect(events).toEqual([
      { month: "2026-06", direction: "in", amount: 100.1, scope: "facturado" },
      { month: "2026-07", direction: "out", amount: 40, scope: "interno" },
      { month: "2026-07", direction: "in", amount: 2000, scope: "otro" },
      { month: "2026-07", direction: "out", amount: 1, scope: "otro" },
    ]);
  });

  it("skips rows whose conversion is unavailable", () => {
    const events = monthlyFlowsToEvents(
      [
        {
          account_id: "usd",
          month: "2026-07",
          kind: "income",
          scope: "otro",
          total: 2,
        },
      ],
      { accountCurrency, toArs: () => null, monthSet },
    );
    expect(events).toEqual([]);
  });

  it("aggregated rows produce the same month totals as per-transaction events", () => {
    // Three ARS transactions in July collapse to one aggregated row.
    const perTx = [10.1, 20.2, 30.3].map((amount) => ({
      month: "2026-07",
      direction: "in" as const,
      amount,
      scope: "facturado" as const,
    }));
    const aggregated = monthlyFlowsToEvents(
      [
        {
          account_id: "ars",
          month: "2026-07",
          kind: "income",
          scope: "facturado",
          total: "60.60",
        },
      ],
      { accountCurrency, toArs, monthSet },
    );
    const months = [{ month: "2026-07", realized: true }];
    const a = buildCashFlow({ months, events: perTx, cashToday: 0 });
    const b = buildCashFlow({ months, events: aggregated, cashToday: 0 });
    expect(b.months[0]?.inFacturado).toBe(a.months[0]?.inFacturado);
    expect(b.months[0]?.inTotal).toBe(60.6);
  });
});

describe("isCashScope", () => {
  it("accepts only the three scopes", () => {
    expect(isCashScope("facturado")).toBe(true);
    expect(isCashScope("interno")).toBe(true);
    expect(isCashScope("otro")).toBe(true);
    expect(isCashScope("fiscal")).toBe(false);
  });
});
