import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import { recordingSupabase } from "@/tests/helpers/recording-supabase";

// listShipmentOptionsAction feeds the carga form's trip select and the
// «Facturar flete» channel select: each read that fails comes back as null,
// not an empty list, and does not take the other one down.

const trip = { id: "t1", trip_date: "2026-11-01", status: "planned" };
let tripsFail = false;
const fake = recordingSupabase(() =>
  tripsFail
    ? { data: null, error: { message: "boom" } }
    : { data: [trip], error: null },
);
let channelsRead:
  | {
      ok: true;
      channels: {
        id: string;
        name: string;
        is_fiscal: boolean;
        is_active: boolean;
      }[];
    }
  | { ok: false } = { ok: true, channels: [] };

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
  readInvoicingChannels: async () => channelsRead,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { listShipmentOptionsAction } = await import("./shipments-actions");

beforeEach(() => {
  channelsRead = { ok: true, channels: [] };
  tripsFail = false;
});

describe("listShipmentOptionsAction and the channels", () => {
  it("keeps the trips when the channel read fails", async () => {
    channelsRead = { ok: false };
    expect(await listShipmentOptionsAction()).toEqual({
      ok: true,
      data: { trips: [trip], channels: null },
    });
  });

  it("keeps the channels when the trips read fails", async () => {
    tripsFail = true;
    expect(await listShipmentOptionsAction()).toEqual({
      ok: true,
      data: { trips: null, channels: [] },
    });
  });

  it("lists the active channels only", async () => {
    channelsRead = {
      ok: true,
      channels: [
        { id: "a", name: "Jouve", is_fiscal: true, is_active: true },
        { id: "b", name: "Viejo", is_fiscal: false, is_active: false },
      ],
    };
    const res = await listShipmentOptionsAction();
    expect(res.ok && res.data.channels).toEqual([
      { id: "a", name: "Jouve", is_fiscal: true },
    ]);
  });
});
