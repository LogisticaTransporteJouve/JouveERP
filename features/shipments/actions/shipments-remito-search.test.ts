import { describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import {
  filterValue,
  recordingSupabase,
} from "@/tests/helpers/recording-supabase";

const fake = recordingSupabase(() => ({
  data: [
    {
      id: "s1",
      remito_number: "0001-00000037",
      scheduled_date: "2026-08-01",
      status: "delivered",
      client: { legal_name: "Cliente SA" },
    },
  ],
  error: null,
}));

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["operations"]),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));

const { findShipmentsByRemitoAction } = await import(
  "./shipments-remito-search"
);

describe("findShipmentsByRemitoAction", () => {
  it("filters the remito number exactly in SQL, so newer near-matches cannot crowd it out of the cap", async () => {
    const res = await findShipmentsByRemitoAction({
      sales_point: 1,
      number: 37,
    });
    const [read] = fake.calls;
    expect(read && filterValue(read, "match", "remito_number")).toBe(
      "(^|[^0-9])0*37[^0-9]*$",
    );
    expect(read && filterValue(read, "ilike", "remito_number")).toBeUndefined();
    expect(res.ok && res.data.map((s) => s.id)).toEqual(["s1"]);
  });
});
