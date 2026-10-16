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
}));

import { listFleetDocumentsAction } from "@/features/fleet-documents/actions/fleet-documents-actions";
import { getFleetProfitabilityAction } from "@/features/fleet-reports/actions/profitability-actions";
import { listFuelLoadsAction } from "@/features/fuel/actions/fuel-actions";
import { listMaintenanceAction } from "@/features/maintenance/actions/maintenance-actions";
import { listTripsAction } from "@/features/trips/actions/trips-actions";
import { listVehiclesAction } from "@/features/vehicles/actions/vehicles-actions";

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

    expect((await runTrips()).summary).toContain("trips");
    expect((await runFuelLoads()).summary).toContain("fuel");
    expect((await runMaintenance()).summary).toContain("maintenance");
    expect((await runFleetDocuments()).summary).toContain("documents");
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
        totals: { revenue: 1000, cost: 400, net: 600 },
      },
    });
    const res = await runFleetProfitability({
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.summary).toContain("600");
    expect(getFleetProfitabilityAction).toHaveBeenCalledWith({
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
  });
});
