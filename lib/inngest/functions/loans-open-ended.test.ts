import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  handler: null as ((ctx: unknown) => Promise<unknown>) | null,
  config: null as unknown,
  rpc: vi.fn(),
  list: vi.fn(),
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
  getServiceClient: () => ({
    rpc: h.rpc,
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => h.list(),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

await import("./loans-open-ended");

const step = {
  run: async (_id: string, fn: () => Promise<unknown>) => fn(),
};

describe("loans-open-ended-extend", () => {
  beforeEach(() => {
    h.rpc.mockReset();
    h.list.mockReset();
  });

  it("runs daily in Argentina time", () => {
    expect(h.config).toMatchObject({
      id: "loans-open-ended-extend",
      triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires 23 5 * * *" }],
    });
  });

  it("extends each active open-ended loan and sums what it inserted", async () => {
    h.list.mockResolvedValue({
      data: [{ id: "l1" }, { id: "l2" }],
      error: null,
    });
    h.rpc.mockResolvedValueOnce({ data: 1, error: null });
    h.rpc.mockResolvedValueOnce({ data: 0, error: null });
    await expect(h.handler?.({ step })).resolves.toEqual({
      loans: 2,
      inserted: 1,
      failed: [],
    });
    expect(h.rpc).toHaveBeenCalledWith("extend_open_ended_loan", {
      p_loan_id: "l1",
    });
    expect(h.rpc).toHaveBeenCalledWith("extend_open_ended_loan", {
      p_loan_id: "l2",
    });
  });

  it("a failing loan does not sink the others", async () => {
    h.list.mockResolvedValue({
      data: [{ id: "l1" }, { id: "l2" }],
      error: null,
    });
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    h.rpc.mockResolvedValueOnce({ data: 2, error: null });
    await expect(h.handler?.({ step })).resolves.toEqual({
      loans: 2,
      inserted: 2,
      failed: ["l1"],
    });
  });

  it("throws when the loans cannot be listed so Inngest retries", async () => {
    h.list.mockResolvedValue({ data: null, error: { message: "down" } });
    await expect(h.handler?.({ step })).rejects.toThrow(
      "list open-ended loans: down",
    );
  });
});
