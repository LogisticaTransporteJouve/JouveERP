import { describe, expect, it } from "vitest";

import {
  isSyncPeriodOld,
  oldestSyncMonth,
  syncPeriodFromMonths,
} from "./arca-sync-period";

describe("syncPeriodFromMonths", () => {
  it("covers whole months and stops at today", () => {
    expect(syncPeriodFromMonths("2026-09", "2026-10", "2026-11-04")).toEqual({
      from: "2026-09-01",
      to: "2026-10-31",
    });
    expect(syncPeriodFromMonths("2026-11", "2026-11", "2026-11-04")).toEqual({
      from: "2026-11-01",
      to: "2026-11-04",
    });
  });

  it("refuses a reversed, future or too long period", () => {
    expect(syncPeriodFromMonths("2026-10", "2026-09", "2026-11-04")).toMatch(
      /anterior/,
    );
    expect(syncPeriodFromMonths("2026-12", "2026-12", "2026-11-04")).toMatch(
      /futuro/,
    );
    expect(syncPeriodFromMonths("2025-10", "2026-10", "2026-11-04")).toMatch(
      /hasta 12 meses/,
    );
    expect(syncPeriodFromMonths("2026-13", "2026-11", "2026-11-04")).toMatch(
      /Elegí/,
    );
  });

  it("refuses a period more than five years back, the usual wrong year", () => {
    expect(syncPeriodFromMonths("2014-12", "2015-11", "2026-11-05")).toMatch(
      /últimos 5 años/,
    );
    expect(syncPeriodFromMonths("2021-01", "2021-03", "2026-11-05")).toEqual({
      from: "2021-01-01",
      to: "2021-03-31",
    });
  });

  it("warns on a period starting more than a year back", () => {
    expect(isSyncPeriodOld("2025-10", "2026-11-05")).toBe(true);
    expect(isSyncPeriodOld("2025-11", "2026-11-05")).toBe(false);
    expect(oldestSyncMonth("2026-11-05")).toBe("2021-01");
  });
});
