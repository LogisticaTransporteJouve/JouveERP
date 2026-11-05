import { describe, expect, it, vi } from "vitest";

const TODAY = "2026-11-03";
// ranges(): the current window ends today, the previous one before it.
const isNow = (to: unknown) => to === TODAY;

// Two clients with the same margin drop (10% → 50% of revenue in cost).
// Acme shares a trip with another client's carga still to invoice in the
// current window, so its share of that trip's cost is not final.
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "ai_client_net_revenue") {
        return {
          data: [
            { client_id: "c1", legal_name: "Acme", net_revenue_ars: 200_000 },
            { client_id: "c2", legal_name: "Beta", net_revenue_ars: 200_000 },
          ],
          error: null,
        };
      }
      if (name === "ai_fleet_margin") {
        const now = isNow(args.p_to);
        return {
          data: ["c1", "c2"].map((id) => ({
            group_key: id,
            trip_cost: now ? 100_000 : 20_000,
            fuel_cost: 0,
            maintenance_cost: 0,
            maintenance_without_cost: 0,
            uninvoiced_shipments: id === "c1" && now ? 1 : 0,
            total_groups: 2,
          })),
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

describe("gatherIndicators client margin with cargas still to invoice", () => {
  it("leaves out a client whose margin is not final in either window", async () => {
    const run = await gatherIndicators(TODAY);
    expect(run.failed).not.toContain("client_margin_drop");
    const card = run.findings.find((f) => f.kind === "client_margin_drop");
    expect(card?.finding).toContain("1 cliente(s)");
    expect(card?.finding).toContain("Beta");
    expect(card?.finding).not.toContain("Acme");
  });
});
