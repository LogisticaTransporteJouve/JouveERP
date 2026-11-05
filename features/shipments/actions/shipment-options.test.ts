import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import { recordingSupabase } from "@/tests/helpers/recording-supabase";

// listShipmentOptionsAction feeds the «Facturar flete» channel select: a
// failed channel read is an error, not an empty select.

const fake = recordingSupabase(() => ({
  data: [{ id: "t1", trip_date: "2026-11-01", status: "planned" }],
  error: null,
}));
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
});

describe("listShipmentOptionsAction and the channels", () => {
  it("fails when the channel read fails", async () => {
    channelsRead = { ok: false };
    expect(await listShipmentOptionsAction()).toEqual({
      ok: false,
      error: "No se pudieron cargar las opciones.",
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
