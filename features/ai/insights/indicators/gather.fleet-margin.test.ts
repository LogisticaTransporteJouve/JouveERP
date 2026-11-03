import { beforeEach, describe, expect, it, vi } from "vitest";

let totalGroups = 1;

// Only the client-margin RPCs answer; every other indicator's read fails,
// which isolates them in `failed` and leaves this one to the test.
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({
    rpc: async (name: string) => {
      if (name === "ai_client_net_revenue") {
        return {
          data: [{ client_id: "c1", legal_name: "Acme", net_revenue_ars: 100 }],
          error: null,
        };
      }
      if (name === "ai_fleet_margin") {
        return {
          data: [
            {
              group_key: "c1",
              trip_cost: 10,
              fuel_cost: 0,
              maintenance_cost: 0,
              total_groups: totalGroups,
            },
          ],
          error: null,
        };
      }
      return { data: null, error: { message: "not in this test" } };
    },
    from: () => {
      throw new Error("not in this test");
    },
  }),
}));

const { gatherIndicators } = await import("./gather");

beforeEach(() => {
  totalGroups = 1;
});

describe("gatherIndicators client margin", () => {
  it("runs when every group fits in one RPC page", async () => {
    const run = await gatherIndicators("2026-11-03");
    expect(run.failed).not.toContain("client_margin_drop");
  });

  it("fails the indicator past the RPC's group cap instead of reading cost 0", async () => {
    totalGroups = 501;
    const run = await gatherIndicators("2026-11-03");
    expect(run.failed).toContain("client_margin_drop");
  });
});
