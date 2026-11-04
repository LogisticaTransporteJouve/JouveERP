import { describe, expect, it, vi } from "vitest";

const TODAY = "2026-11-03";
// ranges(): the current window ends today, the previous one before it.
const isNow = (to: unknown) => to === TODAY;

// Two trucks with the same km and the same cost rise. AA111AA had a service
// with no cost in the previous window, so its previous cost is not known.
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "ai_vehicle_activity") {
        return {
          data: ["v1", "v2"].map((id) => ({
            vehicle_id: id,
            patente: id === "v1" ? "AA111AA" : "BB222BB",
            odometer_km: 2000,
            trip_km: 2000,
            fuel_liters: 0,
          })),
          error: null,
        };
      }
      if (name === "ai_fleet_margin") {
        const now = isNow(args.p_to);
        return {
          data: ["v1", "v2"].map((id) => ({
            group_key: id,
            trip_cost: now ? 2000 : 1000,
            fuel_cost: 0,
            maintenance_cost: 0,
            maintenance_without_cost: id === "v1" && !now ? 1 : 0,
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

describe("gatherIndicators cost per km", () => {
  it("leaves out a truck with a service of unknown cost in either window", async () => {
    const run = await gatherIndicators(TODAY);
    expect(run.failed).not.toContain("vehicle_cost_per_km");
    const card = run.findings.find((f) => f.kind === "vehicle_cost_per_km");
    expect(card?.finding).toContain("1 vehículo(s)");
    expect(card?.finding).toContain("BB222BB");
    expect(card?.finding).not.toContain("AA111AA");
  });
});
