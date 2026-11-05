import { describe, expect, it, vi } from "vitest";

import { resolveAccess, type Role } from "@/lib/auth/permissions";
import { recordingSupabase } from "@/tests/helpers/recording-supabase";

// «Viajes de hoy» links each trip to its page, which only shows its cargas
// (shipments:read). A driver, who reads trips but not cargas, goes to the
// trips list instead of a page that redirects him away.

let roles: Role[] = ["operations"];
const fake = recordingSupabase((call) =>
  call.table === "trips"
    ? {
        data: [
          {
            id: "t1",
            status: "planned",
            origin: null,
            destination: null,
            vehicle: null,
            driver: null,
            shipments: [],
          },
        ],
        error: null,
      }
    : { data: [], error: null },
);

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, []),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { getDashboardTodayAction } = await import("./dashboard-actions");

async function tripHref(): Promise<string | undefined> {
  const res = await getDashboardTodayAction();
  if (!res.ok || !res.data.trips?.ok) return undefined;
  return res.data.trips.data[0]?.href;
}

describe("getDashboardTodayAction trip links", () => {
  it("links to the trip's cargas with shipments:read", async () => {
    roles = ["operations"];
    expect(await tripHref()).toBe("/trips/t1");
  });

  it("links the driver to the trips list", async () => {
    roles = ["driver"];
    expect(await tripHref()).toBe("/trips");
  });
});
