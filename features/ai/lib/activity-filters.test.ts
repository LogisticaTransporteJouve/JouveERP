import { describe, expect, it } from "vitest";

import { activityFilters } from "./activity-filters";

describe("activityFilters", () => {
  it("shows the vehicle and the period of a usage query", () => {
    expect(
      activityFilters({
        vehicle: "AB123CD",
        from: "2026-10-01",
        to: "2026-10-31",
      }),
    ).toEqual(["AB123CD", "01/10/2026 – 31/10/2026"]);
  });

  it("formats a month and keeps a single day as one date", () => {
    expect(activityFilters({ period: "2025-10" })).toEqual(["10/2025"]);
    expect(activityFilters({ from: "2026-11-06", to: "2026-11-06" })).toEqual([
      "06/11/2026",
    ]);
  });

  it("leaves out paging, ids, empty and nested values", () => {
    expect(
      activityFilters({
        employee: "Gómez Ana",
        limit: 50,
        offset: 0,
        tripId: "6f1c2a3b-1234-4abc-9def-0123456789ab",
        kind: "",
        filters: { a: 1 },
        tags: ["x"],
      }),
    ).toEqual(["Gómez Ana"]);
  });

  it("says when only one end of the range was given", () => {
    expect(activityFilters({ from: "2026-01-01" })).toEqual([
      "desde 01/01/2026",
    ]);
  });

  it("returns nothing for a tool without input", () => {
    expect(activityFilters(undefined)).toEqual([]);
    expect(activityFilters({})).toEqual([]);
  });
});
