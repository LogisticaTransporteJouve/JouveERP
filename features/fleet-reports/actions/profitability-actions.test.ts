import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";
import { pagedSupabase } from "@/tests/helpers/paged-supabase";

let roles: Role[] = ["operations"];
let fake = pagedSupabase({});

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));

const { getFleetProfitabilityAction } = await import("./profitability-actions");

const range = { periodStart: "2026-01-01", periodEnd: "2026-12-31" };

beforeEach(() => {
  roles = ["operations"];
});

describe("getFleetProfitabilityAction", () => {
  it("drains every page, so totals cover more rows than one response holds", async () => {
    const trips = Array.from({ length: 1500 }, (_, i) => ({
      id: `t${i}`,
      trip_date: "2026-03-01",
      vehicle_id: "v1",
      origin: null,
      destination: null,
      revenue: 10,
      cost: 1,
      vehicle: { patente: "AA111AA" },
      driver: null,
    }));
    const fuel = Array.from({ length: 1200 }, () => ({
      vehicle_id: "v1",
      trip_id: null,
      amount: 2,
    }));
    fake = pagedSupabase({
      trips,
      fuel_loads: fuel,
      maintenance_records: [{ vehicle_id: "v1", cost: 100 }],
      vehicles: [{ id: "v1", patente: "AA111AA" }],
    });
    const res = await getFleetProfitabilityAction(range);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.trips).toHaveLength(1500);
    expect(res.data.totals.revenue).toBe(15000);
    // 1500 trip cost + 2400 fuel + 100 maintenance
    expect(res.data.totals.cost).toBe(4000);
    expect(res.data.unvouchered.fuel_count).toBe(1200);
    expect(
      fake.calls.filter((c) => c.table === "trips").length,
    ).toBeGreaterThan(1);
  });

  it("fails instead of returning a partial total when a page errors", async () => {
    fake = pagedSupabase(
      { trips: [], fuel_loads: [], maintenance_records: [], vehicles: [] },
      { failOn: "fuel_loads" },
    );
    const res = await getFleetProfitabilityAction(range);
    expect(res.ok).toBe(false);
  });
});
