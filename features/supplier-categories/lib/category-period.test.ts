import { describe, expect, it } from "vitest";

import {
  categoryPeriodRange,
  categoryPeriodToUrl,
  DEFAULT_CATEGORY_PERIOD,
  parseCategoryPeriodParams,
} from "./category-period";

describe("category page period", () => {
  it("opens on the current year", () => {
    expect(parseCategoryPeriodParams({})).toEqual(DEFAULT_CATEGORY_PERIOD);
    expect(categoryPeriodRange(DEFAULT_CATEGORY_PERIOD, "2026-11-05")).toEqual({
      from: "2026-01-01",
      to: "2026-11-05",
    });
  });

  it("keeps «Todas las fechas» across a reload", () => {
    const all = { preset: null, from: null, to: null };
    const url = categoryPeriodToUrl({ period: all });
    expect(url.period).toBe("all");
    expect(parseCategoryPeriodParams(url)).toEqual(all);
    expect(categoryPeriodRange(all)).toEqual({
      from: "1900-01-01",
      to: "9999-12-31",
    });
  });

  it("round-trips a custom range and falls back on a broken one", () => {
    const custom = {
      preset: "custom" as const,
      from: "2026-03-01",
      to: "2026-03-31",
    };
    expect(
      parseCategoryPeriodParams(categoryPeriodToUrl({ period: custom })),
    ).toEqual(custom);
    expect(parseCategoryPeriodParams({ period: "custom", from: "x" })).toEqual(
      DEFAULT_CATEGORY_PERIOD,
    );
  });
});
