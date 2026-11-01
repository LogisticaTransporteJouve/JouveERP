import { describe, expect, it } from "vitest";

import {
  bucketOf,
  formatBucket,
  listGroupParam,
  parseListGroupParam,
  parsePeriodParams,
  resolvePeriod,
} from "./list-period";

// 2026-10-31 is a Saturday.
const TODAY = "2026-10-31";

describe("resolvePeriod", () => {
  it("returns null when no preset is set", () => {
    expect(resolvePeriod({ preset: null, from: null, to: null }, TODAY)).toBe(
      null,
    );
  });

  it.each([
    ["today", "2026-10-31", "2026-10-31"],
    ["yesterday", "2026-10-30", "2026-10-30"],
    ["this_week", "2026-10-26", "2026-10-31"],
    ["this_month", "2026-10-01", "2026-10-31"],
    ["last_month", "2026-09-01", "2026-09-30"],
  ] as const)("resolves %s", (preset, from, to) => {
    expect(resolvePeriod({ preset, from: null, to: null }, TODAY)).toEqual({
      from,
      to,
    });
  });

  it("crosses the year for last month and yesterday", () => {
    expect(
      resolvePeriod(
        { preset: "last_month", from: null, to: null },
        "2026-01-01",
      ),
    ).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(
      resolvePeriod(
        { preset: "yesterday", from: null, to: null },
        "2026-01-01",
      ),
    ).toEqual({ from: "2025-12-31", to: "2025-12-31" });
  });

  it("keeps a custom range", () => {
    expect(
      resolvePeriod(
        { preset: "custom", from: "2026-01-05", to: "2026-02-10" },
        TODAY,
      ),
    ).toEqual({ from: "2026-01-05", to: "2026-02-10" });
  });
});

describe("parsePeriodParams", () => {
  it("ignores an unknown preset", () => {
    expect(parsePeriodParams({ period: "forever" }).preset).toBe(null);
  });

  it("drops from/to unless the preset is custom", () => {
    expect(
      parsePeriodParams({
        period: "today",
        from: "2026-01-01",
        to: "2026-01-02",
      }),
    ).toEqual({ preset: "today", from: null, to: null });
  });

  it("drops a custom range missing a bound or with a bad date", () => {
    expect(
      parsePeriodParams({ period: "custom", from: "2026-01-01" }).preset,
    ).toBe(null);
    expect(
      parsePeriodParams({ period: "custom", from: "x", to: "2026-01-02" })
        .preset,
    ).toBe(null);
  });

  it("reads a bare from/to pair as a custom range", () => {
    expect(parsePeriodParams({ from: "2026-01-01", to: "2026-01-31" })).toEqual(
      { preset: "custom", from: "2026-01-01", to: "2026-01-31" },
    );
  });

  it("orders a reversed custom range", () => {
    expect(
      parsePeriodParams({
        period: "custom",
        from: "2026-02-01",
        to: "2026-01-01",
      }),
    ).toEqual({ preset: "custom", from: "2026-01-01", to: "2026-02-01" });
  });
});

describe("bucketOf", () => {
  it("groups by Monday-start week and by month", () => {
    expect(bucketOf("2026-11-01", "week")).toBe("2026-10-26"); // Sunday
    expect(bucketOf("2026-10-26", "week")).toBe("2026-10-26"); // Monday
    expect(bucketOf("2026-10-31", "month")).toBe("2026-10-01");
    expect(bucketOf("2026-10-31", "day")).toBe("2026-10-31");
  });
});

describe("formatBucket", () => {
  it("labels each grouping", () => {
    expect(formatBucket("2026-10-31", "day")).toBe("sáb 31/10/2026");
    expect(formatBucket("2026-10-26", "week")).toBe(
      "Semana del 26/10/2026 al 01/11/2026",
    );
    expect(formatBucket("2026-10-01", "month")).toBe("octubre 2026");
  });
});

describe("list grouping param", () => {
  it("defaults to day and reads none as the plain list", () => {
    expect(parseListGroupParam(undefined)).toBe("day");
    expect(parseListGroupParam("year")).toBe("day");
    expect(parseListGroupParam("none")).toBe(null);
    expect(parseListGroupParam("month")).toBe("month");
  });

  it("omits the default from the URL", () => {
    expect(listGroupParam("day")).toBe(null);
    expect(listGroupParam(null)).toBe("none");
    expect(listGroupParam("week")).toBe("week");
  });
});
