import { describe, expect, it, vi } from "vitest";

import { pagedSupabase } from "@/tests/helpers/paged-supabase";
import { resolveAccess } from "@/lib/auth/permissions";

const EVEN = "00000000-0000-4000-8000-0000000000e0";
const ODD = "00000000-0000-4000-8000-0000000000d1";

const trips = Array.from({ length: 2300 }, (_, i) => ({
  id: `t${i}`,
  trip_date: i < 100 ? "2026-10-15" : "2026-03-01",
  vehicle_id: i % 2 === 0 ? EVEN : ODD,
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
const fake = pagedSupabase({ trips }, { applyFilters: true });

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

describe("listTripsAction filters", () => {
  it("narrows by vehicle and date range", async () => {
    const res = await listTripsAction({
      vehicleId: EVEN,
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toHaveLength(50);
    expect(res.data.every((t) => t.vehicle_id === EVEN)).toBe(true);
  });

  it("reads only the first `limit` rows, in one request", async () => {
    const before = fake.calls.length;
    const res = await listTripsAction({ limit: 30 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toHaveLength(30);
    expect(fake.calls.length - before).toBe(1);
  });

  it("refuses a filter that is not valid", async () => {
    const res = await listTripsAction({ vehicleId: "AB123CD" });
    expect(res).toEqual({ ok: false, error: "Filtros inválidos." });
  });
});
