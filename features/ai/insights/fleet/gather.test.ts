import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  recordingSupabase,
  type FakeResponse,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

vi.mock("server-only", () => ({}));

/** Pages per table, served in order; past the last one, an empty page. */
let pages: Record<string, FakeResponse[]> = {};
const fake = recordingSupabase(
  (call: RecordedCall) =>
    pages[call.table]?.shift() ?? { data: [], error: null },
);
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));

const { gatherFleetDocExpiry } = await import("./gather");

beforeEach(() => {
  pages = {};
  fake.calls.length = 0;
});

describe("gatherFleetDocExpiry", () => {
  it("throws on a failed read instead of reporting nothing to expire", async () => {
    pages.fleet_documents = [{ data: null, error: { message: "timeout" } }];
    await expect(gatherFleetDocExpiry("2026-11-03")).rejects.toThrow("timeout");
  });
});
