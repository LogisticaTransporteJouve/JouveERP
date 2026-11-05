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
      v_trip_revenue: trips.map((t) => ({
        trip_id: t.id,
        revenue: 10,
        revenue_source: "manual",
        invoiced_revenue: 0,
      })),
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
      {
        trips: [],
        v_trip_revenue: [],
        fuel_loads: [],
        maintenance_records: [],
        vehicles: [],
      },
      { failOn: "fuel_loads" },
    );
    const res = await getFleetProfitabilityAction(range);
    expect(res.ok).toBe(false);
  });

  it("uses the invoiced freight of a trip with shipments", async () => {
    fake = pagedSupabase({
      trips: [
        {
          id: "t1",
          trip_date: "2026-03-01",
          vehicle_id: "v1",
          origin: null,
          destination: null,
          revenue: 1000,
          cost: 0,
          vehicle: { patente: "AA111AA" },
          driver: null,
        },
      ],
      v_trip_revenue: [
        {
          trip_id: "t1",
          revenue: 300,
          revenue_source: "invoiced",
          invoiced_revenue: 300,
        },
      ],
      fuel_loads: [],
      maintenance_records: [],
      vehicles: [{ id: "v1", patente: "AA111AA" }],
    });
    const res = await getFleetProfitabilityAction(range);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.trips[0]).toMatchObject({
      revenue: 300,
      revenue_source: "invoiced",
      invoiced_revenue: 300,
      manual_revenue: 1000,
    });
    expect(res.data.totals.revenue).toBe(300);
  });

  it("counts a trip with a carga still to invoice as pending, even with no freight", async () => {
    fake = pagedSupabase({
      trips: [
        {
          id: "t1",
          trip_date: "2026-03-01",
          vehicle_id: null,
          origin: null,
          destination: null,
          revenue: null,
          cost: 400,
          vehicle: null,
          driver: null,
        },
      ],
      v_trip_revenue: [
        {
          trip_id: "t1",
          revenue: 0,
          revenue_source: "invoiced",
          invoiced_revenue: 0,
          uninvoiced_freight: 0,
          uninvoiced_shipments: 1,
        },
      ],
      fuel_loads: [],
      maintenance_records: [],
      vehicles: [],
    });
    const res = await getFleetProfitabilityAction(range);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.trips[0]).toMatchObject({ uninvoiced_shipments: 1 });
    expect(res.data.without_vehicle).toMatchObject({ trips: 1, net: -400 });
    expect(res.data.totals).toMatchObject({
      cost: 400,
      net: -400,
      pending_invoicing_trips: 1,
    });
  });

  it("leaves a cancelled trip out, keeping its fuel at vehicle level", async () => {
    const trip = (id: string, status: string) => ({
      id,
      trip_date: "2026-03-01",
      status,
      vehicle_id: "v1",
      origin: null,
      destination: null,
      revenue: 1000,
      cost: 200,
      vehicle: { patente: "AA111AA" },
      driver: null,
    });
    const revenue = (tripId: string) => ({
      trip_id: tripId,
      trip_date: "2026-03-01",
      revenue: 1000,
      revenue_source: "manual",
      invoiced_revenue: 0,
    });
    fake = pagedSupabase(
      {
        trips: [trip("t1", "completed"), trip("t2", "cancelled")],
        v_trip_revenue: [revenue("t1"), revenue("t2")],
        fuel_loads: [
          {
            vehicle_id: "v1",
            trip_id: "t2",
            amount: 50,
            load_date: "2026-03-01",
          },
        ],
        maintenance_records: [],
        vehicles: [{ id: "v1", patente: "AA111AA" }],
      },
      { applyFilters: true },
    );
    const res = await getFleetProfitabilityAction(range);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.trips.map((t) => t.id)).toEqual(["t1"]);
    expect(res.data.vehicles[0]).toMatchObject({ trips: 1, fuel_cost: 50 });
    expect(res.data.totals).toMatchObject({ revenue: 1000, cost: 250 });
  });

  it("counts a trip's load dated before the range in the trip, not in the vehicle", async () => {
    fake = pagedSupabase(
      {
        trips: [
          {
            id: "t1",
            trip_date: "2026-03-01",
            vehicle_id: "v1",
            origin: null,
            destination: null,
            revenue: null,
            cost: 50,
            vehicle: { patente: "AA111AA" },
            driver: null,
          },
        ],
        v_trip_revenue: [
          {
            trip_id: "t1",
            trip_date: "2026-03-01",
            revenue: 100,
            revenue_source: "invoiced",
            invoiced_revenue: 100,
          },
        ],
        // Filled the night before the trip.
        fuel_loads: [
          {
            vehicle_id: "v1",
            trip_id: "t1",
            amount: 60,
            load_date: "2026-02-28",
            trip: { trip_date: "2026-03-01" },
          },
        ],
        maintenance_records: [],
        vehicles: [{ id: "v1", patente: "AA111AA" }],
      },
      { applyFilters: true },
    );
    const res = await getFleetProfitabilityAction({
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.trips[0]).toMatchObject({ fuel_cost: 60, net: -10 });
    expect(res.data.vehicles[0]).toMatchObject({ fuel_cost: 0, net: 50 });
  });

  it("requires shipments:read, since revenue comes from the shipments", async () => {
    roles = ["driver"];
    const res = await getFleetProfitabilityAction(range);
    expect(res.ok).toBe(false);
  });
});
