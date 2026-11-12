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
  it("inserts the carga as the actor and audits it", async () => {
    const { db, calls } = fakeDb({ data: { id: "s1" }, error: null });
    const res = await createShipment(db, "u1", {
      kind: "retiro",
      description: "Pallets",
      origin: "Depósito Norte",
      destination: "Av. Corrientes 1234, CABA",
      time_window: "8 a 12 hs",
    });
    expect(res).toEqual({ ok: true, data: { id: "s1" } });
    expect(calls[0]?.payload).toEqual({
      client_id: null,
      trip_id: null,
      kind: "retiro",
      origin: "Depósito Norte",
      destination: "Av. Corrientes 1234, CABA",
      description: "Pallets",
      scheduled_date: null,
      unload_date: null,
      time_window: "8 a 12 hs",
      notes: null,
      created_by: "u1",
    });
    expect(logAudit).toHaveBeenCalledWith("shipment.created", "u1", {}, "s1");
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
