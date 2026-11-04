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
import type { MaintenanceRecord } from "@/features/maintenance/schema";
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
        {
          trip_id: "t1",
          revenue: 1000,
          uninvoiced_freight: 0,
          uninvoiced_shipments: 0,
        },
        {
          trip_id: "t2",
          revenue: 5000,
          uninvoiced_freight: 0,
          uninvoiced_shipments: 0,
        },
      ],
    });
    const res = await runTrips(OPERATIONS);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary).toContain("1 cancelled");
    expect(res.summary).toContain("revenue of the 1 not cancelled $1.000");
    expect(res.summary).not.toContain("6.000");
    expect(res.summary).not.toContain("sin facturar");
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

  it("says how much freight the trips still have to invoice", async () => {
    vi.mocked(listTripsAction).mockResolvedValue({
      ok: true,
      data: [
        trip("t1", "completed", null),
        trip("t2", "completed", null),
        // Cancelled: its pending freight does not count.
        trip("t3", "cancelled", null),
      ],
    });
    vi.mocked(listTripRevenueAction).mockResolvedValue({
      ok: true,
      data: [
        {
          trip_id: "t1",
          revenue: 0,
          uninvoiced_freight: 800,
          uninvoiced_shipments: 1,
        },
        {
          trip_id: "t2",
          revenue: 500,
          uninvoiced_freight: 0,
          uninvoiced_shipments: 0,
        },
        {
          trip_id: "t3",
          revenue: 0,
          uninvoiced_freight: 900,
          uninvoiced_shipments: 1,
        },
      ],
    });
    const res = await runTrips(OPERATIONS);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary).toContain(
      "1 carga(s) sin facturar en 1 viaje(s) (flete $800; una carga por tarifa no tiene flete hasta facturarse): no está en los ingresos",
    );
    expect(res.data).toEqual([
      expect.objectContaining({
        id: "t1",
        revenue: 0,
        uninvoiced_freight: 800,
        uninvoiced_shipments: 1,
      }),
      expect.objectContaining({ id: "t2", uninvoiced_freight: 0 }),
      expect.objectContaining({ id: "t3", uninvoiced_freight: 900 }),
    ]);
  });

  it("counts a trip whose carga is priced by tariff as pending", async () => {
    vi.mocked(listTripsAction).mockResolvedValue({
      ok: true,
      data: [trip("t1", "completed", null)],
    });
    vi.mocked(listTripRevenueAction).mockResolvedValue({
      ok: true,
      data: [
        // No freight until its liquidación is invoiced.
        {
          trip_id: "t1",
          revenue: 0,
          uninvoiced_freight: 0,
          uninvoiced_shipments: 2,
        },
      ],
    });
    const res = await runTrips(OPERATIONS);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary).toContain(
      "2 carga(s) sin facturar en 1 viaje(s) (sin flete calculado todavía;",
    );
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

const MAINTENANCE: MaintenanceRecord = {
  id: "m",
  vehicle_id: "v1",
  service_date: "2026-10-01",
  kind: "service",
  description: "Service",
  cost: null,
  odometer_km: null,
  next_service_date: null,
  next_service_km: null,
  provider: null,
  notes: null,
  purchase_invoice_id: null,
  transaction_id: null,
  created_at: "2026-10-01T00:00:00Z",
  vehicle: null,
};

describe("runMaintenance cost", () => {
  it("leaves a record without cost out of the total and counts it", async () => {
    vi.mocked(listMaintenanceAction).mockResolvedValue({
      ok: true,
      data: [{ cost: 1000 }, { cost: null }, { cost: 500 }].map((m, i) => ({
        ...MAINTENANCE,
        id: `m${i}`,
        ...m,
      })),
    });
    const res = await runMaintenance();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary).toBe(
      "3 maintenance records · $1.500 · 1 without cost (not in the total).",
    );
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
        without_vehicle: null,
        totals: {
          revenue: 1000,
          invoiced_revenue: 700,
          manual_revenue: 300,
          cost: 400,
          net: 600,
          uninvoiced_freight: 0,
          pending_invoicing_trips: 0,
          uninvoiced_shipments: 0,
          maintenance_without_cost: 0,
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
    if (res.ok) expect(res.summary).not.toContain("sin facturar");
    expect(getFleetProfitabilityAction).toHaveBeenCalledWith({
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
  });

  it("says the net is not final when freight is still to invoice", async () => {
    vi.mocked(getFleetProfitabilityAction).mockResolvedValue({
      ok: true,
      data: {
        trips: [],
        vehicles: [],
        without_vehicle: null,
        totals: {
          revenue: 0,
          invoiced_revenue: 0,
          manual_revenue: 0,
          cost: 400,
          net: -400,
          uninvoiced_freight: 1500,
          pending_invoicing_trips: 2,
          uninvoiced_shipments: 3,
          maintenance_without_cost: 0,
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
    if (res.ok) {
      expect(res.summary).toContain(
        "3 carga(s) sin facturar en 2 viaje(s) (flete $1.500; una carga por tarifa no tiene flete hasta facturarse): no está en los ingresos, así que esos netos no son definitivos",
      );
    }
  });

  it("says the trips without a vehicle and the services without cost are in the totals", async () => {
    vi.mocked(getFleetProfitabilityAction).mockResolvedValue({
      ok: true,
      data: {
        trips: [],
        vehicles: [],
        without_vehicle: {
          trips: 2,
          revenue: 500,
          invoiced_revenue: 500,
          uninvoiced_freight: 0,
          uninvoiced_shipments: 0,
          manual_revenue: 0,
          trip_cost: 400,
          net: 100,
        },
        totals: {
          revenue: 500,
          invoiced_revenue: 500,
          manual_revenue: 0,
          cost: 400,
          net: 100,
          uninvoiced_freight: 0,
          pending_invoicing_trips: 0,
          uninvoiced_shipments: 0,
          maintenance_without_cost: 1,
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
    if (!res.ok) return;
    expect(res.summary).toContain(
      "(+ 2 trip(s) without a vehicle, in the totals)",
    );
    expect(res.summary).toContain("1 service(s) sin costo cargado");
  });
});
