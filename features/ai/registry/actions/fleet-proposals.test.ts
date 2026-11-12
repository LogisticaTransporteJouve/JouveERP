import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const listVehiclesAction = vi.fn();
const listDriversAction = vi.fn();
const searchClientsAction = vi.fn();
const listShipmentsAction = vi.fn();
const createTrip = vi.fn();
const changeShipmentStatus = vi.fn();
const createFuelLoad = vi.fn();
const userDb = { kind: "user-client" };

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
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => userDb }));
vi.mock("@/lib/commands/create-trip", () => ({ createTrip }));
vi.mock("@/lib/commands/create-shipment", () => ({ createShipment: vi.fn() }));
vi.mock("@/lib/commands/change-shipment-status", () => ({
  changeShipmentStatus,
}));
vi.mock("@/lib/commands/create-fuel-load", () => ({ createFuelLoad }));
vi.mock("@/lib/commands/create-maintenance", () => ({
  createMaintenance: vi.fn(),
}));

const {
  proposeFuelLoad,
  proposeMaintenance,
  proposeShipment,
  proposeShipmentStatus,
  proposeTrip,
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
  listShipmentsAction.mockResolvedValue({ ok: true, data: [shipment] });
});

describe("proposeTrip", () => {
  it("resolves the truck and the driver and drafts a planned trip", async () => {
    const prepared = await proposeTrip.proposal?.prepareDraft(ctx, {
      trip_date: "2026-11-06",
      vehicle: "ab 123 cd",
      driver: "Pérez",
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toMatchObject({
      trip_date: "2026-11-06",
      vehicle_id: TRUCK,
      driver_id: DRIVER,
      status: "planned",
    });
    expect(prepared.summary).toContainEqual({
      label: "Vehículo",
      value: "AB123CD",
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
  it("drafts the carga for the resolved client", async () => {
    const prepared = await proposeShipment.proposal?.prepareDraft(ctx, {
      client: "acme sa",
      description: "Pallets",
      destination: "Av. Corrientes 1234, CABA",
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toMatchObject({
      client_id: CLIENT,
      description: "Pallets",
      destination: "Av. Corrientes 1234, CABA",
    });
    expect(prepared.summary[0]).toEqual({ label: "Cliente", value: "Acme SA" });
    expect(prepared.summary).toContainEqual({
      label: "Dirección",
      value: "Av. Corrientes 1234, CABA",
    });
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
      value: "En curso → Entregada",
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
