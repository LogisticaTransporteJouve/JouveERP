import { describe, expect, it } from "vitest";

import { periodBounds, periodOf, previousPeriod } from "./accounting-period";

describe("accounting period helpers", () => {
  it("bounds a month, leap February included", () => {
    expect(periodBounds("2026-10")).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(periodBounds("2028-02").to).toBe("2028-02-29");
    expect(periodBounds("2026-02").to).toBe("2026-02-28");
  });

  it("steps back across the year", () => {
    expect(previousPeriod("2026-01")).toBe("2025-12");
    expect(previousPeriod("2026-11")).toBe("2026-10");
  });

  it("takes a date's period", () => {
    expect(periodOf("2026-11-02")).toBe("2026-11");
  });
});
