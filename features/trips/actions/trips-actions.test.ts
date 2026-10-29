import { describe, expect, it, vi } from "vitest";

import { pagedSupabase } from "@/tests/helpers/paged-supabase";
import { resolveAccess } from "@/lib/auth/permissions";

const trips = Array.from({ length: 2300 }, (_, i) => ({
  id: `t${i}`,
  trip_date: "2026-03-01",
  vehicle_id: null,
  driver_id: null,
  channel_id: null,
  origin: null,
  destination: null,
  cargo_description: null,
  status: "completed",
  km: null,
  revenue: 1,
  cost: null,
  notes: null,
  created_at: "2026-03-01T00:00:00Z",
  updated_at: "2026-03-01T00:00:00Z",
}));
const fake = pagedSupabase({ trips });

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["operations"]),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { listTripsAction } = await import("./trips-actions");

describe("listTripsAction", () => {
  it("returns every trip, not just the first response page", async () => {
    const res = await listTripsAction();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toHaveLength(2300);
  });
});
