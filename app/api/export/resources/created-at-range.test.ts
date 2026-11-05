import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  filterValue,
  recordingSupabase,
} from "@/tests/helpers/recording-supabase";

// Exports of master data filter `created_at` (a timestamp): a bare «Hasta»
// date compares as its midnight and drops the rows created that day.

let fake = recordingSupabase(() => ({ data: [], error: null }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));

const { EXPORTERS } = await import("../exporters");

const RANGE = { from: "2026-11-01", to: "2026-11-05" };

beforeEach(() => {
  fake = recordingSupabase(() => ({ data: [], error: null }));
});

describe.each([
  "accounts",
  "clients",
  "suppliers",
  "supplier-categories",
  "drivers",
  "vehicles",
  "fleet-documents",
  "employees",
  "warehouses",
  "products",
  "cost-centers",
])("%s export", (resource) => {
  it("keeps the rows created on the «Hasta» day", async () => {
    const exporter = EXPORTERS[resource];
    expect(exporter).toBeDefined();
    await exporter?.load(new URLSearchParams(), RANGE);

    const [call] = fake.calls;
    expect(call).toBeDefined();
    if (!call) return;
    expect(filterValue(call, "gte", "created_at")).toBe("2026-11-01");
    expect(filterValue(call, "lte", "created_at")).toBe(
      "2026-11-05T23:59:59.999",
    );
  });
});
