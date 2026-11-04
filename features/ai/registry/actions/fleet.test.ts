import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/vehicles/actions/vehicles-actions", () => ({
  listVehiclesAction: vi.fn(),
}));
vi.mock("@/features/trips/actions/trips-actions", () => ({
  listTripsAction: vi.fn(),
}));
vi.mock("@/features/fuel/actions/fuel-actions", () => ({
  listFuelLoadsAction: vi.fn(),
}));
vi.mock("@/features/maintenance/actions/maintenance-actions", () => ({
  listMaintenanceAction: vi.fn(),
}));
vi.mock("@/features/fleet-documents/actions/fleet-documents-actions", () => ({
  listFleetDocumentsAction: vi.fn(),
}));
vi.mock("@/features/fleet-reports/actions/profitability-actions", () => ({
  getFleetProfitabilityAction: vi.fn(),
  listTripRevenueAction: vi.fn(),
}));

import { listFleetDocumentsAction } from "@/features/fleet-documents/actions/fleet-documents-actions";
import {
  getFleetProfitabilityAction,
  listTripRevenueAction,
} from "@/features/fleet-reports/actions/profitability-actions";
import { listFuelLoadsAction } from "@/features/fuel/actions/fuel-actions";
import { listMaintenanceAction } from "@/features/maintenance/actions/maintenance-actions";
import { listTripsAction } from "@/features/trips/actions/trips-actions";
import type { Trip, TripStatus } from "@/features/trips/schema";
import { listVehiclesAction } from "@/features/vehicles/actions/vehicles-actions";
import { resolveAccess } from "@/lib/auth/permissions";

import {
  runFleetDocuments,
  runFleetProfitability,
  runFuelLoads,
  runMaintenance,
  runTrips,
  runVehicles,
} from "./fleet";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runVehicles", () => {
  it("summarizes the fleet and passes data through", async () => {
    vi.mocked(listVehiclesAction).mockResolvedValue({ ok: true, data: [] });
    const res = await runVehicles({});
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.summary).toContain("vehicles");
  });

  it("returns an error result when the action fails", async () => {
    vi.mocked(listVehiclesAction).mockResolvedValue({
      ok: false,
      error: "boom",
    });
    const res = await runVehicles({});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("boom");
  });
});

describe("runTrips / runFuelLoads / runMaintenance / runFleetDocuments", () => {
  it("each returns an ok summary", async () => {
    vi.mocked(listTripsAction).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(listFuelLoadsAction).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(listMaintenanceAction).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(listFleetDocumentsAction).mockResolvedValue({
      ok: true,
      data: [],
    });

    vi.mocked(listTripRevenueAction).mockResolvedValue({ ok: true, data: [] });

    expect((await runTrips(OPERATIONS)).summary).toContain("trips");
    expect((await runFuelLoads()).summary).toContain("fuel");
    expect((await runMaintenance()).summary).toContain("maintenance");
    expect((await runFleetDocuments()).summary).toContain("documents");
  });
});

const OPERATIONS = resolveAccess(["operations"]);

function trip(id: string, status: TripStatus, revenue: number | null): Trip {
  return {
    id,
    trip_date: "2026-10-01",
    driver_id: null,
    vehicle_id: null,
    channel_id: null,
    origin: null,
    destination: null,
    cargo_description: null,
    status,
    km: null,
    revenue,
    cost: null,
    notes: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    driver: null,
    vehicle: null,
  };
}

describe("runTrips revenue", () => {
  it("sums the invoiced freight of the trips that are not cancelled", async () => {
    vi.mocked(listTripsAction).mockResolvedValue({
      ok: true,
      data: [
        // No manual revenue: its shipments were invoiced for 1000.
        trip("t1", "completed", null),
        // Cancelled: its manual 5000 is no revenue.
        trip("t2", "cancelled", 5000),
      ],
    });
    vi.mocked(listTripRevenueAction).mockResolvedValue({
      ok: true,
      data: [
        { trip_id: "t1", revenue: 1000 },
        { trip_id: "t2", revenue: 5000 },
      ],
    });
    const res = await runTrips(OPERATIONS);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary).toContain("1 cancelled");
    expect(res.summary).toContain("revenue of the 1 not cancelled $1.000");
    expect(res.summary).not.toContain("6.000");
    expect(res.data).toEqual([
      expect.objectContaining({
        id: "t1",
        revenue: 1000,
        manual_revenue: null,
      }),
      expect.objectContaining({
        id: "t2",
        revenue: 5000,
        manual_revenue: 5000,
      }),
    ]);
  });

  it("gives no revenue total without shipments:read", async () => {
    vi.mocked(listTripsAction).mockResolvedValue({
      ok: true,
      data: [trip("t1", "completed", 300)],
    });
    const res = await runTrips(resolveAccess(["driver"]));
    expect(listTripRevenueAction).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary).toContain("Revenue not summed");
    expect(res.data).toEqual([
      expect.objectContaining({ revenue: null, manual_revenue: 300 }),
    ]);
  });

  it("fails when the revenue read fails", async () => {
    vi.mocked(listTripsAction).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(listTripRevenueAction).mockResolvedValue({
      ok: false,
      error: "boom",
    });
    expect((await runTrips(OPERATIONS)).ok).toBe(false);
  });
});

describe("runFleetProfitability", () => {
  it("rejects an invalid date range without calling the action", async () => {
    const res = await runFleetProfitability({
      periodStart: "2026/01/01",
      periodEnd: "2026-01-31",
    });
    expect(res.ok).toBe(false);
    expect(getFleetProfitabilityAction).not.toHaveBeenCalled();
  });

  it("summarizes net profitability for a valid range", async () => {
    vi.mocked(getFleetProfitabilityAction).mockResolvedValue({
      ok: true,
      data: {
        trips: [],
        vehicles: [],
        totals: {
          revenue: 1000,
          invoiced_revenue: 700,
          manual_revenue: 300,
          cost: 400,
          net: 600,
        },
        unvouchered: {
          fuel_count: 0,
          fuel_amount: 0,
          maintenance_count: 0,
          maintenance_cost: 0,
        },
      },
    });
    const res = await runFleetProfitability({
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.summary).toContain("600");
    if (res.ok) expect(res.summary).toContain("invoiced $700");
    expect(getFleetProfitabilityAction).toHaveBeenCalledWith({
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
  });
});
