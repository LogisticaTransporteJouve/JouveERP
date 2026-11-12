import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import {
  filterValue,
  recordingSupabase,
} from "@/tests/helpers/recording-supabase";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const TRIP = "00000000-0000-4000-8000-0000000000f1";

let fake = recordingSupabase(() => ({ data: [{ id: A }], error: null }));

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["operations"], []),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/channels", () => ({
  readInvoicingChannels: async () => ({ ok: true, channels: [] }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ rpc }),
}));

const { setShipmentsTripAction } = await import("./shipments-actions");

const update = () =>
  fake.calls.find((c) => c.table === "shipments" && c.op === "update");

beforeEach(() => {
  fake = recordingSupabase(() => ({ data: [{ id: A }], error: null }));
  rpc.mockReset();
  rpc.mockResolvedValue({ data: 1, error: null });
});

describe("setShipmentsTripAction", () => {
  it("assigns only cargas still without a trip and reports how many moved", async () => {
    const res = await setShipmentsTripAction({
      tripId: TRIP,
      shipmentIds: [A, B],
    });
    expect(res).toEqual({ ok: true, data: { count: 1, warning: null } });
    const call = update();
    expect(call?.payload).toEqual({ trip_id: TRIP });
    expect(call && filterValue(call, "in", "id")).toEqual([A, B]);
    expect(call && filterValue(call, "is", "trip_id")).toBeNull();
    expect(call && filterValue(call, "in", "status")).toEqual([
      "not_started",
      "reprogrammed",
    ]);
  });

  it("takes a carga off its trip without the unassigned filter", async () => {
    await setShipmentsTripAction({ tripId: null, shipmentIds: [A] });
    const call = update();
    expect(call?.payload).toEqual({ trip_id: null });
    expect(call && filterValue(call, "is", "trip_id")).toBeUndefined();
  });

  it("syncs the status of the cargas that moved, as the actor", async () => {
    await setShipmentsTripAction({ tripId: TRIP, shipmentIds: [A, B] });
    expect(rpc).toHaveBeenCalledWith("sync_shipment_trip_status", {
      p_shipment_ids: [A],
      p_actor: "u1",
    });
  });

  it("keeps the assignment and warns when the status sync fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await setShipmentsTripAction({
      tripId: null,
      shipmentIds: [A],
    });
    expect(res).toEqual({
      ok: true,
      data: {
        count: 1,
        warning: "Se guardó, pero no se actualizó el estado de las cargas.",
      },
    });
  });

  it("rejects an empty selection", async () => {
    const res = await setShipmentsTripAction({ tripId: TRIP, shipmentIds: [] });
    expect(res.ok).toBe(false);
    expect(update()).toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });
});
