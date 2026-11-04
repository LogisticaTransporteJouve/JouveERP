import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  filterValue,
  recordingSupabase,
  type FakeResponse,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

vi.mock("server-only", () => ({}));

/** Pages per table, served in order; past the last one, an empty page. */
let pages: Record<string, FakeResponse[]> = {};
const fake = recordingSupabase(
  (call: RecordedCall) =>
    pages[call.table]?.shift() ?? { data: [], error: null },
);
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));

const { gatherFleetDocExpiry, gatherTripMargins } = await import("./gather");

const trip = (id: string, cost = 0) => ({
  id,
  trip_date: "2026-10-01",
  origin: "Rosario",
  destination: "Córdoba",
  cost,
});
const revenue = (tripId: string, amount: number) => ({
  trip_id: tripId,
  revenue: amount,
});

beforeEach(() => {
  pages = {};
  fake.calls.length = 0;
});

describe("gatherTripMargins", () => {
  it("drains trips and their fuel past one page, scoped to those trips", async () => {
    pages.trips = [
      { data: [trip("t1")], error: null },
      { data: [trip("t2")], error: null },
    ];
    pages.v_trip_revenue = [
      { data: [revenue("t1", 100), revenue("t2", 100)], error: null },
    ];
    pages.fuel_loads = [
      { data: [{ id: "f1", trip_id: "t1", amount: 60 }], error: null },
      { data: [{ id: "f2", trip_id: "t2", amount: 150 }], error: null },
    ];
    const findings = await gatherTripMargins("2026-11-03");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.source_refs).toEqual(["t2"]);
    const fuelRead = fake.calls.find((c) => c.table === "fuel_loads");
    expect(fuelRead && filterValue(fuelRead, "in", "trip_id")).toEqual([
      "t1",
      "t2",
    ]);
  });

  it("judges a trip on its invoiced freight and skips cancelled trips", async () => {
    // No manual revenue on the trip: the view's invoiced freight is the
    // revenue, so 1000 - 300 - 0 is not a loss.
    pages.trips = [{ data: [trip("t1", 300)], error: null }];
    pages.v_trip_revenue = [{ data: [revenue("t1", 1000)], error: null }];
    const findings = await gatherTripMargins("2026-11-03");
    expect(findings).toEqual([]);
    const tripsRead = fake.calls.find((c) => c.table === "trips");
    expect(tripsRead && filterValue(tripsRead, "neq", "status")).toBe(
      "cancelled",
    );
    const revenueRead = fake.calls.find((c) => c.table === "v_trip_revenue");
    expect(revenueRead && filterValue(revenueRead, "in", "trip_id")).toEqual([
      "t1",
    ]);
  });

  it("throws when the revenue read fails", async () => {
    pages.trips = [{ data: [trip("t1")], error: null }];
    pages.v_trip_revenue = [{ data: null, error: { message: "timeout" } }];
    await expect(gatherTripMargins("2026-11-03")).rejects.toThrow("timeout");
  });

  it("throws on a failed read instead of reporting no losing trips", async () => {
    pages.trips = [{ data: null, error: { message: "timeout" } }];
    await expect(gatherTripMargins("2026-11-03")).rejects.toThrow("timeout");
  });

  it("throws when the fuel read fails", async () => {
    pages.trips = [{ data: [trip("t1")], error: null }];
    pages.v_trip_revenue = [{ data: [revenue("t1", 100)], error: null }];
    pages.fuel_loads = [{ data: null, error: { message: "timeout" } }];
    await expect(gatherTripMargins("2026-11-03")).rejects.toThrow("timeout");
  });
});

describe("gatherFleetDocExpiry", () => {
  it("throws on a failed read instead of reporting nothing to expire", async () => {
    pages.fleet_documents = [{ data: null, error: { message: "timeout" } }];
    await expect(gatherFleetDocExpiry("2026-11-03")).rejects.toThrow("timeout");
  });
});
