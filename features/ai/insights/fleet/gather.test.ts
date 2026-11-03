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

const trip = (id: string, revenue: number) => ({
  id,
  trip_date: "2026-10-01",
  origin: "Rosario",
  destination: "Córdoba",
  revenue,
  cost: 0,
});

beforeEach(() => {
  pages = {};
  fake.calls.length = 0;
});

describe("gatherTripMargins", () => {
  it("drains trips and their fuel past one page, scoped to those trips", async () => {
    pages.trips = [
      { data: [trip("t1", 100)], error: null },
      { data: [trip("t2", 100)], error: null },
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

  it("throws on a failed read instead of reporting no losing trips", async () => {
    pages.trips = [{ data: null, error: { message: "timeout" } }];
    await expect(gatherTripMargins("2026-11-03")).rejects.toThrow("timeout");
  });

  it("throws when the fuel read fails", async () => {
    pages.trips = [{ data: [trip("t1", 100)], error: null }];
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
