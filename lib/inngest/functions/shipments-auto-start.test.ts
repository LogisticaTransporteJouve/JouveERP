import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  handler: null as ((ctx: unknown) => Promise<unknown>) | null,
  config: null as unknown,
  rpc: vi.fn(),
}));

vi.mock("../client", () => ({
  inngest: {
    createFunction: (
      config: unknown,
      handler: (ctx: unknown) => Promise<unknown>,
    ) => {
      h.config = config;
      h.handler = handler;
      return {};
    },
  },
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ rpc: h.rpc }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

await import("./shipments-auto-start");

const step = {
  run: async (_id: string, fn: () => Promise<unknown>) => fn(),
};

describe("shipments-auto-start", () => {
  beforeEach(() => h.rpc.mockReset());

  it("runs daily in Argentina time", () => {
    expect(h.config).toMatchObject({
      id: "shipments-auto-start",
      triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires 7 0 * * *" }],
    });
  });

  it("syncs every carga (no ids) and returns how many started", async () => {
    h.rpc.mockResolvedValue({ data: 3, error: null });
    await expect(h.handler?.({ step })).resolves.toEqual({ started: 3 });
    expect(h.rpc).toHaveBeenCalledWith("sync_shipment_trip_status", {});
  });

  it("throws on an RPC error so Inngest retries", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(h.handler?.({ step })).rejects.toThrow(
      "sync_shipment_trip_status: boom",
    );
  });
});
