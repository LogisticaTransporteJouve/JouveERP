import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Trip } from "@/features/trips/schema";
import { resolveAccess } from "@/lib/auth/permissions";

const listVehiclesAction = vi.fn();
const listTripsAction = vi.fn();
const getVehicleActivityAction = vi.fn();

vi.mock("@/features/vehicles/actions/vehicles-actions", () => ({
  listVehiclesAction,
}));
vi.mock("@/features/drivers/actions/drivers-actions", () => ({
  listDriversAction: vi.fn(),
}));
vi.mock("@/features/trips/actions/trips-actions", () => ({
  listTripsAction,
  getTripAction: vi.fn(),
}));
vi.mock("@/features/fleet-reports/actions/activity-actions", () => ({
  getVehicleActivityAction,
}));
vi.mock("@/features/shipments/actions/shipments-actions", () => ({
  listShipmentsAction: vi.fn(),
  listShipmentsByTripAction: vi.fn(),
}));

const { getVehicleUsage, driversOf } = await import("./fleet-detail");
const { refKey } = await import("./fleet-refs");

const TRUCK = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const ctx = { userId: "u1", access: resolveAccess(["operations"]) };

function trip(
  id: string,
  date: string,
  driver: string | null,
  km: number | null,
  status: Trip["status"] = "completed",
): Trip {
  return {
    id,
    trip_date: date,
    driver_id: driver,
    vehicle_id: TRUCK,
    channel_id: null,
    origin: null,
    destination: null,
    cargo_description: null,
    status,
    km,
    revenue: null,
    cost: null,
    notes: null,
    created_at: `${date}T00:00:00Z`,
    updated_at: `${date}T00:00:00Z`,
    driver: driver ? { full_name: driver === "d1" ? "Pérez" : "Gómez" } : null,
    vehicle: { patente: "AB 123 CD" },
    companion_employee_id: null,
    companion: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listVehiclesAction.mockResolvedValue({
    ok: true,
    data: [
      { id: TRUCK, patente: "AB 123 CD", alias: "Scania" },
      { id: OTHER, patente: "AC 456 EF", alias: null },
    ],
  });
  listTripsAction.mockResolvedValue({
    ok: true,
    data: [
      trip("t1", "2026-10-02", "d1", 300),
      trip("t2", "2026-10-10", "d1", 200),
      trip("t3", "2026-10-20", "d2", null),
      trip("t4", "2026-10-25", "d2", 900, "cancelled"),
    ],
  });
  getVehicleActivityAction.mockResolvedValue({
    ok: true,
    data: [
      {
        vehicle_id: TRUCK,
        patente: "AB 123 CD",
        odometer_km: 1500,
        odometer_start: 10_000,
        odometer_end: 11_500,
        fuel_liters: 420,
      },
    ],
  });
});

describe("getVehicleUsage", () => {
  it("answers km and drivers of a plate typed without spaces", async () => {
    const res = await getVehicleUsage.execute(ctx, {
      vehicle: "ab123cd",
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(listTripsAction).toHaveBeenCalledWith({
      vehicleId: TRUCK,
      from: "2026-10-01",
      to: "2026-10-31",
      limit: 1000,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toMatchObject({
      vehicle: "AB 123 CD",
      trips: 3,
      cancelled_trips: 1,
      trip_km: 500,
      trips_without_km: 1,
      odometer_km: 1500,
      km_recorridos: 1500,
      fuel_liters: 420,
      drivers: [
        expect.objectContaining({ driver: "Pérez", trips: 2, km: 500 }),
        expect.objectContaining({ driver: "Gómez", trips: 1, km: 0 }),
      ],
    });
    expect(res.summary).toContain("1.500 km recorridos (Strix)");
    expect(res.summary).toContain("500 km cargados");
  });

  it("names the candidates when a plate matches several vehicles", async () => {
    const res = await getVehicleUsage.execute(ctx, {
      vehicle: "A",
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("AB 123 CD (Scania)");
    expect(listTripsAction).not.toHaveBeenCalled();
  });

  it("needs vehicles:read to find a plate, not to take an id", async () => {
    const noVehicles = {
      userId: "u1",
      access: resolveAccess(["operations"], ["vehicles:read"]),
    };
    const byPlate = await getVehicleUsage.execute(noVehicles, {
      vehicle: "AB123CD",
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(byPlate.ok).toBe(false);
    expect(listVehiclesAction).not.toHaveBeenCalled();
    const byId = await getVehicleUsage.execute(noVehicles, {
      vehicle: TRUCK,
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(byId.ok).toBe(true);
  });
});

describe("driversOf / refKey", () => {
  it("leaves cancelled trips out and keeps the first and last date", () => {
    expect(
      driversOf([
        trip("a", "2026-10-05", "d1", 10),
        trip("b", "2026-10-01", "d1", 20),
        trip("c", "2026-10-09", "d1", 30, "cancelled"),
      ]),
    ).toEqual([
      {
        driver_id: "d1",
        driver: "Pérez",
        trips: 2,
        km: 30,
        trips_without_km: 0,
        first_trip: "2026-10-01",
        last_trip: "2026-10-05",
      },
    ]);
  });

  it("ignores case, spaces, dashes and accents", () => {
    expect(refKey("ab-123 cd")).toBe("AB123CD");
    expect(refKey("Gómez")).toBe("GOMEZ");
  });
});
