import { describe, expect, it } from "vitest";

import { treasuryTotals } from "./treasury-totals";

describe("treasuryTotals", () => {
  it("keeps a USD check cartera apart from the peso one", () => {
    const t = treasuryTotals([
      { type: "bank", currency: "ARS", balance_now: 100, balance_prev_eom: 90 },
      {
        type: "checks",
        currency: "ARS",
        balance_now: 50,
        balance_prev_eom: 40,
      },
      { type: "checks", currency: "USD", balance_now: 7, balance_prev_eom: 5 },
      { type: "echeq", currency: "USD", balance_now: 0.1, balance_prev_eom: 0 },
      { type: "echeq", currency: "USD", balance_now: 0.2, balance_prev_eom: 0 },
    ]);
    expect(t.liquid_now).toEqual({ ARS: 100, USD: 0 });
    expect(t.checks_now).toEqual({ ARS: 50, USD: 7.3 });
    expect(t.checks_prev_eom).toEqual({ ARS: 40, USD: 5 });
  });
});
