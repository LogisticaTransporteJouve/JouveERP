import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Permission } from "@/lib/auth/permissions";
import {
  recordingSupabase,
  type FakeResponse,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

let denied: Permission[] = [];
let before: FakeResponse = { data: null, error: null };
let after: FakeResponse = { data: null, error: null };
const fake = recordingSupabase((call: RecordedCall) =>
  call.filters.some(([kind]) => kind === "lte") ? before : after,
);

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["finance"], denied),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));

const { getUsdReferenceRateAction } = await import("./exchange-rates-actions");

beforeEach(() => {
  denied = [];
  before = { data: null, error: null };
  after = { data: null, error: null };
  fake.calls.length = 0;
});

describe("getUsdReferenceRateAction", () => {
  it("prefers the nearest rate on or before the date", async () => {
    before = { data: { rate_date: "2026-11-02", rate: "1450" }, error: null };
    after = { data: { rate_date: "2026-11-05", rate: "1500" }, error: null };
    expect(await getUsdReferenceRateAction("2026-11-03")).toEqual({
      ok: true,
      data: { rate_date: "2026-11-02", rate: 1450, earlier: true },
    });
  });

  it("falls back to the nearest later rate, and to null with none", async () => {
    after = { data: { rate_date: "2026-11-05", rate: 1500 }, error: null };
    expect(await getUsdReferenceRateAction("2026-11-03")).toEqual({
      ok: true,
      data: { rate_date: "2026-11-05", rate: 1500, earlier: false },
    });
    after = { data: null, error: null };
    expect(await getUsdReferenceRateAction("2026-11-03")).toEqual({
      ok: true,
      data: null,
    });
  });

  it("fails instead of reporting no rate when a read fails", async () => {
    after = { data: null, error: { message: "timeout" } };
    const res = await getUsdReferenceRateAction("2026-11-03");
    expect(res.ok).toBe(false);
  });

  it("requires accounting:read", async () => {
    denied = ["accounting:read"];
    const res = await getUsdReferenceRateAction("2026-11-03");
    expect(res.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });
});
