import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

// «Reprogramar» with «Asignar a viaje»: the trip part needs trips:write too.

const SHIPMENT = "00000000-0000-4000-8000-00000000000a";
const TRIP = "00000000-0000-4000-8000-0000000000f1";

const h = vi.hoisted(() => ({ denied: [] as string[] }));
const changeShipmentStatus = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["operations"], h.denied),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/commands/change-shipment-status", () => ({
  changeShipmentStatus: (...args: unknown[]) => changeShipmentStatus(...args),
}));

const { changeShipmentStatusAction } = await import("./shipments-actions");

const input = {
  id: SHIPMENT,
  status: "reprogrammed",
  scheduled_date: "2026-11-20",
  trip_id: TRIP,
};

beforeEach(() => {
  h.denied = [];
  changeShipmentStatus.mockReset();
  changeShipmentStatus.mockResolvedValue({ ok: true, data: { warning: null } });
});

describe("changeShipmentStatusAction with a trip", () => {
  it("reprograms onto the trip with shipments:write and trips:write", async () => {
    const res = await changeShipmentStatusAction(input);
    expect(res).toEqual({ ok: true, data: { warning: null } });
    expect(changeShipmentStatus).toHaveBeenCalledWith(
      {},
      "u1",
      expect.objectContaining({ trip_id: TRIP }),
    );
  });

  it("refuses the trip when trips:write is denied, before writing", async () => {
    h.denied = ["trips:write"];
    const res = await changeShipmentStatusAction(input);
    expect(res).toEqual({
      ok: false,
      error: "No tenés permiso para asignar cargas a viajes.",
    });
    expect(changeShipmentStatus).not.toHaveBeenCalled();
  });

  it("still reprograms without a trip when trips:write is denied", async () => {
    h.denied = ["trips:write"];
    const res = await changeShipmentStatusAction({ ...input, trip_id: null });
    expect(res.ok).toBe(true);
  });
});
