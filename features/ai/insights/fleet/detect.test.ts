import { describe, expect, it } from "vitest";

import {
  detectFleetDocExpiry,
  detectLossTrips,
  type FleetDocRow,
  type TripMarginRow,
} from "./detect";

const TODAY = "2026-07-01";

const doc = (over: Partial<FleetDocRow>): FleetDocRow => ({
  id: "d1",
  expires_at: "2026-12-31",
  label: "ABC123 (vtv)",
  ...over,
});

describe("detectFleetDocExpiry", () => {
  it("returns nothing when all documents are far from expiring", () => {
    expect(detectFleetDocExpiry([doc({ expires_at: "2027-01-01" })], TODAY)).toEqual([]);
  });

  it("flags critical when a document is already expired", () => {
    const out = detectFleetDocExpiry(
      [doc({ id: "a", expires_at: "2026-06-01" })],
      TODAY,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe("critical");
    expect(out[0]?.kind).toBe("fleet_doc_expiry");
    expect(out[0]?.metrics.expired).toBe(1);
    expect(out[0]?.source_refs).toContain("a");
  });

  it("flags warning when only expiring within the horizon", () => {
    const out = detectFleetDocExpiry(
      [doc({ id: "b", expires_at: "2026-07-15" })],
      TODAY,
    );
    expect(out[0]?.severity).toBe("warning");
    expect(out[0]?.metrics.expiring_soon).toBe(1);
  });
});

const trip = (over: Partial<TripMarginRow>): TripMarginRow => ({
  id: "t1",
  label: "2026-06-30 Rosario → CABA",
  net: 0,
  ...over,
});

describe("detectLossTrips", () => {
  it("returns nothing when no trip loses money", () => {
    expect(detectLossTrips([trip({ net: 1000 }), trip({ net: 0 })])).toEqual([]);
  });

  it("flags loss trips and reports the worst", () => {
    const out = detectLossTrips([
      trip({ id: "a", net: -5000 }),
      trip({ id: "b", net: -20000, label: "peor" }),
      trip({ id: "c", net: 3000 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("trip_margin");
    expect(out[0]?.metrics.loss_count).toBe(2);
    expect(out[0]?.metrics.total_loss).toBe(-25000);
    expect(out[0]?.finding).toContain("peor");
    expect(out[0]?.source_refs).toEqual(["a", "b"]);
  });
});
