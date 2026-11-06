import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const listVehiclesAction = vi.fn();
const listDriversAction = vi.fn();
const searchClientsAction = vi.fn();
const listShipmentsAction = vi.fn();
const findShipmentRemitoConflictAction = vi.fn();
const getVehicleKmMonthAction = vi.fn();
const createTrip = vi.fn();
const changeShipmentStatus = vi.fn();
const createFuelLoad = vi.fn();
const saveVehicleKmReading = vi.fn();
const listFreightSettlementCandidatesAction = vi.fn();
const saveFreightSettlement = vi.fn();
const userDb = { kind: "user-client" };
const serviceDb = { kind: "service-client" };

vi.mock("@/features/vehicles/actions/vehicles-actions", () => ({
  listVehiclesAction,
}));
vi.mock("@/features/drivers/actions/drivers-actions", () => ({
  listDriversAction,
}));
vi.mock("@/features/clients/actions/clients-actions", () => ({
  searchClientsAction,
}));
vi.mock("@/features/shipments/actions/shipments-actions", () => ({
  listShipmentsAction,
  findShipmentRemitoConflictAction,
}));
vi.mock("@/features/vehicle-km/actions/vehicle-km-actions", () => ({
  getVehicleKmMonthAction,
}));
vi.mock(
  "@/features/freight-settlements/actions/freight-settlements-actions",
  () => ({ listFreightSettlementCandidatesAction }),
);
vi.mock("@/lib/commands/save-freight-settlement", () => ({
  saveFreightSettlement,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => userDb }));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => serviceDb,
}));
vi.mock("@/lib/commands/create-trip", () => ({ createTrip }));
vi.mock("@/lib/commands/create-shipment", () => ({ createShipment: vi.fn() }));
vi.mock("@/lib/commands/change-shipment-status", () => ({
  changeShipmentStatus,
}));
vi.mock("@/lib/commands/create-fuel-load", () => ({ createFuelLoad }));
vi.mock("@/lib/commands/create-maintenance", () => ({
  createMaintenance: vi.fn(),
}));
vi.mock("@/lib/commands/save-vehicle-km-reading", () => ({
  saveVehicleKmReading,
}));

const {
  proposeFreightSettlement,
  proposeFuelLoad,
  proposeMaintenance,
  proposeShipment,
  proposeShipmentStatus,
  proposeTrip,
  proposeVehicleKm,
} = await import("./fleet-proposals");

const ctx = { userId: "u1", access: resolveAccess(["operations"]) };
const TRUCK = "00000000-0000-4000-8000-0000000000f1";
const DRIVER = "00000000-0000-4000-8000-0000000000f2";
const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const SHIPMENT = "00000000-0000-4000-8000-0000000000a1";

const shipment = {
  id: SHIPMENT,
  remito_number: "R-100",
  scheduled_date: "2026-11-04",
  status: "in_progress",
  client: { legal_name: "Acme SA", display_name: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  listVehiclesAction.mockResolvedValue({
    ok: true,
    data: [
      { id: TRUCK, patente: "AB123CD", alias: "Scania" },
      { id: "v2", patente: "AC456EF", alias: null },
    ],
  });
  listDriversAction.mockResolvedValue({
    ok: true,
    data: [{ id: DRIVER, full_name: "Juan Pérez" }],
  });
  searchClientsAction.mockResolvedValue({
    ok: true,
    data: { clients: [{ id: CLIENT, legal_name: "Acme SA", cuit: null }] },
  });
  findShipmentRemitoConflictAction.mockResolvedValue({ ok: true, data: null });
  listShipmentsAction.mockResolvedValue({ ok: true, data: [shipment] });
});

describe("proposeTrip", () => {
  it("resolves the truck and the driver and drafts a planned trip", async () => {
    const prepared = await proposeTrip.proposal?.prepareDraft(ctx, {
      trip_date: "2026-11-06",
      vehicle: "ab 123 cd",
      driver: "Pérez",
      origin: "Rosario",
      destination: "Córdoba",
      revenue: 850_000,
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toMatchObject({
      trip_date: "2026-11-06",
      vehicle_id: TRUCK,
      driver_id: DRIVER,
      status: "planned",
      revenue: 850_000,
      cost: null,
    });
    expect(prepared.summary).toContainEqual({
      label: "Vehículo",
      value: "AB123CD",
    });
    expect(prepared.summary).toContainEqual({
      label: "Recorrido",
      value: "Rosario → Córdoba",
    });
  });

  it("asks when the plate is not a known vehicle", async () => {
    const prepared = await proposeTrip.proposal?.prepareDraft(ctx, {
      trip_date: "2026-11-06",
      vehicle: "ZZ999ZZ",
    });
    expect(prepared?.kind).toBe("issues");
  });

  it("writes through createTrip with the user's client", async () => {
    createTrip.mockResolvedValue({ ok: true, data: { id: "t1" } });
    const draft = { trip_date: "2026-11-06", status: "planned" };
    const res = await proposeTrip.proposal?.executeDraft(ctx, draft);
    expect(res).toEqual({ ok: true, data: { id: "t1" } });
    expect(createTrip).toHaveBeenCalledWith(
      userDb,
      "u1",
      expect.objectContaining({ trip_date: "2026-11-06" }),
    );
  });
});

describe("proposeShipment", () => {
  it("refuses a remito the client already has on another carga", async () => {
    findShipmentRemitoConflictAction.mockResolvedValue({
      ok: true,
      data: { id: "other", status: "not_started" },
    });
    const prepared = await proposeShipment.proposal?.prepareDraft(ctx, {
      client: "Acme SA",
      remito_number: "R-100",
    });
    expect(prepared).toEqual({
      kind: "issues",
      issues: [
        {
          field: "remito_number",
          message: "Ese número de remito ya está en otra carga del cliente.",
        },
      ],
    });
  });

  it("drafts the carga for the resolved client", async () => {
    const prepared = await proposeShipment.proposal?.prepareDraft(ctx, {
      client: "acme sa",
      remito_number: "R-101",
      freight_amount: 120_000,
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toMatchObject({
      client_id: CLIENT,
      remito_number: "R-101",
      freight_amount: 120_000,
    });
    expect(prepared.summary[0]).toEqual({ label: "Cliente", value: "Acme SA" });
  });
});

describe("proposeShipmentStatus", () => {
  it("drafts the delivery for today with the carga's current status", async () => {
    const prepared = await proposeShipmentStatus.proposal?.prepareDraft(ctx, {
      shipment_id: SHIPMENT,
      status: "delivered",
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toMatchObject({
      id: SHIPMENT,
      status: "delivered",
      delivery_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      failure_reason: null,
    });
    expect(prepared.summary).toContainEqual({
      label: "Estado",
      value: "En progreso → Entregada",
    });
    expect(listShipmentsAction).toHaveBeenCalledWith({
      id: SHIPMENT,
      limit: 1,
    });
  });

  it("refuses a transition the carga's status does not allow", async () => {
    listShipmentsAction.mockResolvedValue({
      ok: true,
      data: [{ ...shipment, status: "delivered" }],
    });
    const prepared = await proposeShipmentStatus.proposal?.prepareDraft(ctx, {
      shipment_id: SHIPMENT,
      status: "cancelled",
      failure_reason: "El cliente no estaba",
    });
    expect(prepared?.kind).toBe("error");
  });

  it("asks for the reason to cancel", async () => {
    const prepared = await proposeShipmentStatus.proposal?.prepareDraft(ctx, {
      shipment_id: SHIPMENT,
      status: "cancelled",
    });
    expect(prepared?.kind).toBe("issues");
  });

  it("will not accept a cancel draft whose reason was cleared", async () => {
    const res = await proposeShipmentStatus.proposal?.executeDraft(ctx, {
      id: SHIPMENT,
      status: "cancelled",
      failure_reason: null,
    });
    expect(res).toEqual({ ok: false, error: "El motivo es obligatorio." });
    expect(changeShipmentStatus).not.toHaveBeenCalled();
  });
});

describe("proposeFuelLoad", () => {
  it("drafts the load for today and writes with the user's access", async () => {
    const prepared = await proposeFuelLoad.proposal?.prepareDraft(ctx, {
      vehicle: "Scania",
      liters: 300,
      amount: 450_000,
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toMatchObject({
      vehicle_id: TRUCK,
      liters: 300,
      amount: 450_000,
    });

    createFuelLoad.mockResolvedValue({ ok: true, data: { id: "f1" } });
    await proposeFuelLoad.proposal?.executeDraft(ctx, prepared.draft);
    expect(createFuelLoad).toHaveBeenCalledWith(
      userDb,
      ctx,
      expect.objectContaining({ vehicle_id: TRUCK }),
    );
  });
});

describe("proposeMaintenance", () => {
  it("defaults to a service today", async () => {
    const prepared = await proposeMaintenance.proposal?.prepareDraft(ctx, {
      vehicle: "AB123CD",
      description: "Cambio de aceite y filtros",
      cost: 180_000,
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toMatchObject({
      vehicle_id: TRUCK,
      kind: "service",
      description: "Cambio de aceite y filtros",
      cost: 180_000,
    });
  });
});

describe("proposeVehicleKm", () => {
  const month = (reading: number | null) => ({
    ok: true,
    data: {
      period: "2026-10",
      missing: 0,
      rows: [
        {
          vehicle_id: TRUCK,
          patente: "AB123CD",
          alias: null,
          vehicle_type: "camion",
          is_active: true,
          reading:
            reading === null
              ? null
              : {
                  id: "r",
                  vehicle_id: TRUCK,
                  period: "2026-10",
                  km: reading,
                  read_on: "2026-10-30",
                  notes: null,
                },
          previous: {
            id: "p",
            vehicle_id: TRUCK,
            period: "2026-09",
            km: 120_000,
            read_on: "2026-09-30",
            notes: null,
          },
          driven: null,
        },
      ],
    },
  });

  it("warns when the km is below the previous reading", async () => {
    getVehicleKmMonthAction.mockResolvedValue(month(null));
    const prepared = await proposeVehicleKm.proposal?.prepareDraft(ctx, {
      vehicle: "AB123CD",
      km: 119_000,
      read_on: "2026-10-31",
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toMatchObject({ period: "2026-10", km: 119_000 });
    expect(prepared.summary.map((r) => r.label)).toContain("Atención");
  });

  it("says it replaces the month's loaded reading", async () => {
    getVehicleKmMonthAction.mockResolvedValue(month(125_000));
    const prepared = await proposeVehicleKm.proposal?.prepareDraft(ctx, {
      vehicle: "AB123CD",
      km: 126_000,
      read_on: "2026-10-31",
    });
    if (prepared?.kind !== "draft") throw new Error("expected a draft");
    expect(prepared.summary.map((r) => r.label)).toEqual(
      expect.arrayContaining(["Recorridos", "Reemplaza"]),
    );
  });

  it("refuses a vehicle the month grid does not list (a trailer)", async () => {
    getVehicleKmMonthAction.mockResolvedValue({
      ok: true,
      data: { period: "2026-10", missing: 0, rows: [] },
    });
    const prepared = await proposeVehicleKm.proposal?.prepareDraft(ctx, {
      vehicle: "AB123CD",
      km: 1000,
      read_on: "2026-10-31",
    });
    expect(prepared?.kind).toBe("error");
  });

  it("writes with the service client, as the Km mensual action", async () => {
    saveVehicleKmReading.mockResolvedValue({ ok: true, data: { id: "k1" } });
    await proposeVehicleKm.proposal?.executeDraft(ctx, {
      vehicle_id: TRUCK,
      period: "2026-10",
      km: 126_000,
      read_on: "2026-10-31",
      notes: null,
    });
    expect(saveVehicleKmReading).toHaveBeenCalledWith(
      serviceDb,
      "u1",
      expect.objectContaining({ km: 126_000 }),
    );
  });
});

describe("proposeFreightSettlement", () => {
  const finance = { userId: "u1", access: resolveAccess(["finance"]) };
  const candidate = (id: string, amount: number | null) => ({
    shipment_id: id,
    remito_number: id,
    service_date: "2026-10-10",
    origin: null,
    destination: null,
    description: null,
    amount,
    price_source: amount === null ? null : "shipment",
  });

  it("takes the priced cargas and says which ones stay out", async () => {
    const A = "00000000-0000-4000-8000-0000000000b1";
    const B = "00000000-0000-4000-8000-0000000000b2";
    listFreightSettlementCandidatesAction.mockResolvedValue({
      ok: true,
      data: [candidate(A, 100_000), candidate(B, null)],
    });
    const prepared = await proposeFreightSettlement.proposal?.prepareDraft(
      finance,
      {
        client: "Acme SA",
        period_start: "2026-10-01",
        period_end: "2026-10-31",
      },
    );
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toMatchObject({
      client_id: CLIENT,
      shipment_ids: [A],
    });
    expect(prepared.summary).toContainEqual({
      label: "Total estimado",
      value: "$ 100.000,00",
    });
    expect(prepared.summary.map((r) => r.label)).toContain("Atención");
  });

  it("refuses when no carga can be settled", async () => {
    listFreightSettlementCandidatesAction.mockResolvedValue({
      ok: true,
      data: [],
    });
    const prepared = await proposeFreightSettlement.proposal?.prepareDraft(
      finance,
      {
        client: "Acme SA",
        period_start: "2026-10-01",
        period_end: "2026-10-31",
      },
    );
    expect(prepared?.kind).toBe("error");
    expect(saveFreightSettlement).not.toHaveBeenCalled();
  });
});
