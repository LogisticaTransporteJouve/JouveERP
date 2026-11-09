import { describe, expect, it } from "vitest";

import { statementPeriodParam, statementRange } from "./statement-period";

describe("statementPeriodParam", () => {
  it("opens on the current month without a period in the URL", () => {
    expect(statementPeriodParam({})).toEqual({
      preset: "this_month",
      from: null,
      to: null,
    });
  });

  it("keeps the URL's period, shared with the movements tab", () => {
    expect(
      statementPeriodParam({
        period: "custom",
        from: "2026-10-01",
        to: "2026-10-31",
      }),
    ).toEqual({ preset: "custom", from: "2026-10-01", to: "2026-10-31" });
  });
});

describe("statementRange", () => {
  it("resolves a preset against today", () => {
    expect(
      statementRange(
        { preset: "last_month", from: null, to: null },
        "2026-11-09",
      ),
    ).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("reads every line up to today for «Todas las fechas»", () => {
    expect(
      statementRange({ preset: null, from: null, to: null }, "2026-11-09"),
    ).toEqual({ from: "2000-01-01", to: "2026-11-09" });
  });
});
