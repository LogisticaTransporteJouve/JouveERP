import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Access } from "@/lib/auth/permissions";
import {
  filterValue,
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const TRIP = "00000000-0000-4000-8000-0000000000f1";
const S1 = "00000000-0000-4000-8000-0000000000a1";
const S2 = "00000000-0000-4000-8000-0000000000a2";
const EMP = "00000000-0000-4000-8000-0000000000e1";

const h = vi.hoisted(() => ({
  access: null as Access | null,
  activeEmployee: true,
  tripShipments: [] as { id: string }[],
}));

/** The user's client: inserts the trip, assigns what it is asked to. */
let user = recordingSupabase(userRespond);
function userRespond(call: RecordedCall) {
  if (call.table === "trips" && call.op === "insert") {
    return { data: { id: TRIP }, error: null };
  }
  if (call.table === "trips" && call.op === "select") {
    return { data: { companion_employee_id: null }, error: null };
  }
  if (call.table === "trips") return { data: [{ id: TRIP }], error: null };
  if (call.table === "shipments" && call.op === "update") {
    return { data: [{ id: S1 }], error: null };
  }
  return { data: null, error: null };
}

/** The service client: the companion check, the trip's cargas, the sync. */
let service = recordingSupabase(serviceRespond);
function serviceRespond(call: RecordedCall) {
  if (call.table === "employees" && call.op === "select") {
    if (filterValue(call, "in", "id") !== undefined) {
      return { data: [{ id: EMP, legal_name: "Ana Gómez" }], error: null };
    }
    return { data: h.activeEmployee ? { id: EMP } : null, error: null };
  }
  // Drained page by page: the trip's cargas, then an empty page.
  if (call.table === "shipments") {
    const page = h.tripShipments;
    h.tripShipments = [];
    return { data: page, error: null };
  }
  if (call.op === "rpc") return { data: 1, error: null };
  return { data: null, error: null };
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1", access: h.access }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => user.client,
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => service.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { createTripAction, updateTripAction, deleteTripAction, getTripAction } =
  await import("./trips-actions");

const syncCalls = () =>
  service.calls.filter((c) => c.table === "sync_shipment_trip_status");

beforeEach(() => {
  h.access = resolveAccess(["operations"]);
  h.activeEmployee = true;
  h.tripShipments = [];
  user = recordingSupabase(userRespond);
  service = recordingSupabase(serviceRespond);
});

describe("createTripAction", () => {
  it("inserts the trip with its Acompañante and assigns the picked cargas", async () => {
    const res = await createTripAction({
      trip_date: "2026-11-12",
      companion_employee_id: EMP,
      shipment_ids: [S1, S2],
    });
    expect(res).toEqual({
      ok: true,
      data: {
        id: TRIP,
        assigned: 1,
        requested: 2,
        assignError: null,
        warning: null,
      },
    });
    const insert = user.calls.find((c) => c.op === "insert");
    expect(insert?.payload).toMatchObject({ companion_employee_id: EMP });
    const assign = user.calls.find(
      (c) => c.table === "shipments" && c.op === "update",
    );
    expect(assign?.payload).toEqual({ trip_id: TRIP });
    expect(assign && filterValue(assign, "in", "id")).toEqual([S1, S2]);
    expect(syncCalls()[0]?.payload).toEqual({
      p_shipment_ids: [S1],
      p_actor: "u1",
    });
  });

  it("refuses an Acompañante who is not an active employee", async () => {
    h.activeEmployee = false;
    const res = await createTripAction({
      trip_date: "2026-11-12",
      companion_employee_id: EMP,
    });
    expect(res).toEqual({
      ok: false,
      error: "El acompañante no es un empleado activo.",
    });
    expect(user.calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("needs shipments:write to take cargas, before inserting", async () => {
    h.access = resolveAccess(["operations"], ["shipments:write"]);
    const res = await createTripAction({
      trip_date: "2026-11-12",
      shipment_ids: [S1],
    });
    expect(res).toEqual({
      ok: false,
      error: "No tenés permiso para asignar cargas.",
    });
    expect(user.calls).toHaveLength(0);
  });

  it("keeps the trip when the assignment fails", async () => {
    user = recordingSupabase((call) =>
      call.table === "shipments"
        ? { data: null, error: { message: "boom" } }
        : userRespond(call),
    );
    const res = await createTripAction({
      trip_date: "2026-11-12",
      shipment_ids: [S1],
    });
    expect(res).toEqual({
      ok: true,
      data: {
        id: TRIP,
        assigned: 0,
        requested: 1,
        assignError: "No se pudieron actualizar las cargas.",
        warning: null,
      },
    });
  });
});

describe("updateTripAction", () => {
  it("syncs the trip's cargas when its date changes", async () => {
    h.tripShipments = [{ id: S1 }, { id: S2 }];
    const res = await updateTripAction({ id: TRIP, trip_date: "2026-11-20" });
    expect(res).toEqual({ ok: true, data: { warning: null } });
    expect(syncCalls()[0]?.payload).toEqual({
      p_shipment_ids: [S1, S2],
      p_actor: "u1",
    });
  });

  it("does not sync when only the driver changes", async () => {
    await updateTripAction({ id: TRIP, driver_id: "" });
    expect(syncCalls()).toHaveLength(0);
  });

  it("checks a new Acompañante", async () => {
    h.activeEmployee = false;
    const res = await updateTripAction({
      id: TRIP,
      companion_employee_id: EMP,
    });
    expect(res).toEqual({
      ok: false,
      error: "El acompañante no es un empleado activo.",
    });
  });
});

describe("deleteTripAction", () => {
  it("syncs the cargas the trip had, read before the delete", async () => {
    h.tripShipments = [{ id: S1 }];
    const res = await deleteTripAction({ id: TRIP });
    expect(res).toEqual({ ok: true, data: { warning: null } });
    expect(syncCalls()[0]?.payload).toEqual({
      p_shipment_ids: [S1],
      p_actor: "u1",
    });
  });
});

describe("getTripAction", () => {
  it("fills the Acompañante's name", async () => {
    user = recordingSupabase(() => ({
      data: {
        id: TRIP,
        trip_date: "2026-11-12",
        status: "planned",
        km: null,
        revenue: null,
        cost: null,
        companion_employee_id: EMP,
      },
      error: null,
    }));
    const res = await getTripAction(TRIP);
    expect(res.ok && res.data?.companion).toEqual({ legal_name: "Ana Gómez" });
  });

  it("fails rather than show no Acompañante when the name read fails", async () => {
    user = recordingSupabase(() => ({
      data: {
        id: TRIP,
        trip_date: "2026-11-12",
        status: "planned",
        km: null,
        revenue: null,
        cost: null,
        companion_employee_id: EMP,
      },
      error: null,
    }));
    service = recordingSupabase(() => ({
      data: null,
      error: { message: "boom" },
    }));
    expect(await getTripAction(TRIP)).toEqual({
      ok: false,
      error: "No se pudo cargar el viaje.",
    });
  });
});
