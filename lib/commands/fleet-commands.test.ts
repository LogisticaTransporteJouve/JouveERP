import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";

const logAudit = vi.fn();
const serviceRpc = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ rpc: serviceRpc }),
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
}));

const { createTrip } = await import("./create-trip");
const { createShipment } = await import("./create-shipment");
const { changeShipmentStatus } = await import("./change-shipment-status");
const { createFuelLoad } = await import("./create-fuel-load");
const { saveVehicleKmReading } = await import("./save-vehicle-km-reading");
const { saveFreightSettlement } = await import("./save-freight-settlement");

type Result = { data: unknown; error: unknown };

/** A client whose insert/upsert/rpc answer `result` and record the call. */
function fakeDb(result: Result) {
  const calls: { op: string; table: string; payload: unknown }[] = [];
  const chain = (op: string, table: string, payload: unknown) => {
    calls.push({ op, table, payload });
    return { select: () => ({ single: async () => result }) };
  };
  const db = {
    from: (table: string) => ({
      insert: (payload: unknown) => chain("insert", table, payload),
      upsert: (payload: unknown) => chain("upsert", table, payload),
    }),
    rpc: async (fn: string, payload: unknown) => {
      calls.push({ op: "rpc", table: fn, payload });
      return result;
    },
  };
  // The fake implements only what the commands call.
  return { db: db as unknown as SupabaseClient<Database>, calls };
}

const VEHICLE = "00000000-0000-4000-8000-000000000001";
const SHIPMENT = "00000000-0000-4000-8000-000000000002";

beforeEach(() => logAudit.mockReset());

describe("createTrip", () => {
  it("inserts the trip as the actor and audits it", async () => {
    const { db, calls } = fakeDb({ data: { id: "t1" }, error: null });
    const res = await createTrip(db, "u1", {
      trip_date: "2026-11-05",
      vehicle_id: VEHICLE,
      status: "planned",
    });
    expect(res).toEqual({ ok: true, data: { id: "t1" } });
    expect(calls[0]?.payload).toMatchObject({
      trip_date: "2026-11-05",
      vehicle_id: VEHICLE,
      driver_id: null,
      created_by: "u1",
    });
    expect(logAudit).toHaveBeenCalledWith(
      "trip.created",
      "u1",
      { trip_date: "2026-11-05" },
      "t1",
    );
  });

  it("writes nothing to the audit when the insert fails", async () => {
    const { db } = fakeDb({ data: null, error: { message: "boom" } });
    const res = await createTrip(db, "u1", {
      trip_date: "2026-11-05",
      status: "planned",
    });
    expect(res).toEqual({ ok: false, error: "No se pudo crear el viaje." });
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("createShipment", () => {
  it("refuses a remito number another carga of the client holds", async () => {
    const { db } = fakeDb({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "shipments_client_remito_unique"',
      },
    });
    const res = await createShipment(db, "u1", { remito_number: "R-1" });
    expect(res).toEqual({
      ok: false,
      error: "Ese número de remito ya está en otra carga del cliente.",
    });
  });
});

describe("changeShipmentStatus", () => {
  it("delivers today when no date is given and audits the transition", async () => {
    const { db, calls } = fakeDb({ data: "in_progress", error: null });
    const res = await changeShipmentStatus(db, "u1", {
      id: SHIPMENT,
      status: "delivered",
    });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(calls[0]?.table).toBe("change_shipment_status");
    expect(calls[0]?.payload).toMatchObject({
      p_id: SHIPMENT,
      p_status: "delivered",
      p_delivery_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(logAudit).toHaveBeenCalledWith(
      "shipment.status_changed",
      "u1",
      { from: "in_progress", to: "delivered" },
      SHIPMENT,
    );
  });

  it("returns the guard's message when the carga changed meanwhile", async () => {
    const { db } = fakeDb({
      data: null,
      error: {
        code: "55006",
        hint: "jouve_guard",
        message:
          "La carga cambió de estado mientras tanto: actualizá la lista y volvé a intentarlo.",
      },
    });
    const res = await changeShipmentStatus(db, "u1", {
      id: SHIPMENT,
      status: "in_progress",
    });
    expect(res).toEqual({
      ok: false,
      error:
        "La carga cambió de estado mientras tanto: actualizá la lista y volvé a intentarlo.",
    });
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("createFuelLoad", () => {
  it("refuses a voucher link the user cannot see, before writing", async () => {
    const { db, calls } = fakeDb({ data: { id: "f1" }, error: null });
    const res = await createFuelLoad(
      db,
      { userId: "u1", access: resolveAccess(["operations"]) },
      {
        vehicle_id: VEHICLE,
        load_date: "2026-11-05",
        liters: 100,
        amount: 150_000,
        purchase_invoice_id: "00000000-0000-4000-8000-000000000009",
      },
    );
    expect(res).toEqual({
      ok: false,
      error: "No tenés permiso para vincular facturas de compra.",
    });
    expect(calls).toHaveLength(0);
  });
});

describe("saveVehicleKmReading", () => {
  it("refuses a future month", async () => {
    const { db, calls } = fakeDb({ data: { id: "k1" }, error: null });
    const res = await saveVehicleKmReading(db, "u1", {
      vehicle_id: VEHICLE,
      period: "2999-01",
      km: 1000,
      read_on: "2026-11-05",
      notes: null,
    });
    expect(res).toEqual({
      ok: false,
      error: "No se puede cargar el km de un mes futuro.",
    });
    expect(calls).toHaveLength(0);
  });

  it("upserts the month's reading and audits it", async () => {
    const { db, calls } = fakeDb({ data: { id: "k1" }, error: null });
    const res = await saveVehicleKmReading(db, "u1", {
      vehicle_id: VEHICLE,
      period: "2026-10",
      km: 120_500,
      read_on: "2026-10-31",
      notes: null,
    });
    expect(res).toEqual({ ok: true, data: { id: "k1" } });
    expect(calls[0]).toMatchObject({
      op: "upsert",
      table: "vehicle_km_readings",
      payload: { loaded_by: "u1", km: 120_500 },
    });
  });
});

describe("saveFreightSettlement", () => {
  const input = {
    client_id: "00000000-0000-4000-8000-0000000000c1",
    period_start: "2026-10-01",
    period_end: "2026-10-31",
    shipment_ids: [SHIPMENT],
    notes: null,
  };

  it("creates the draft and audits it", async () => {
    serviceRpc.mockResolvedValue({ data: "fs1", error: null });
    const res = await saveFreightSettlement("u1", input);
    expect(res).toEqual({ ok: true, data: { id: "fs1" } });
    expect(serviceRpc).toHaveBeenCalledWith(
      "save_freight_settlement",
      expect.objectContaining({ p_user_id: "u1", p_notes: "" }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      "freight_settlement.created",
      "u1",
      expect.objectContaining({ shipments: 1 }),
      "fs1",
    );
  });

  it("returns the guard's message for an unpriced carga", async () => {
    serviceRpc.mockResolvedValue({
      data: null,
      error: {
        code: "23514",
        hint: "jouve_guard",
        message:
          "La carga R-1 no tiene flete ni tarifa de flete vigente: cargá uno de los dos.",
      },
    });
    const res = await saveFreightSettlement("u1", input);
    expect(res).toEqual({
      ok: false,
      error:
        "La carga R-1 no tiene flete ni tarifa de flete vigente: cargá uno de los dos.",
    });
    expect(logAudit).not.toHaveBeenCalled();
  });
});
