import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  filterValue,
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

let respond: (call: RecordedCall) => {
  data: unknown;
  error: unknown;
} = () => ({
  data: null,
  error: null,
});
const fake = recordingSupabase((call) => respond(call));

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));

const { loadEarlierRunOutput, loadRunMemory } = await import("./memory-store");

beforeEach(() => {
  fake.calls.length = 0;
});

describe("run memory loader", () => {
  it("has nothing to remember on a first run", async () => {
    expect(await loadRunMemory("u1", "w1", null)).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  it("reads only succeeded runs of the same user and task", async () => {
    respond = (call) =>
      filterValue(call, "eq", "id")
        ? {
            data: {
              id: "p1",
              scheduled_for: "2026-10-12T11:00:00Z",
              summary: "s",
              output: "o",
            },
            error: null,
          }
        : { data: [], error: null };
    const memory = await loadRunMemory("u1", "w1", "p1");
    expect(memory?.previousRunId).toBe("p1");
    for (const call of fake.calls) {
      expect(filterValue(call, "eq", "user_id")).toBe("u1");
      expect(filterValue(call, "eq", "workflow_id")).toBe("w1");
      expect(filterValue(call, "eq", "status")).toBe("succeeded");
    }
  });

  it("returns null for a run of another user or task", async () => {
    respond = () => ({ data: null, error: null });
    expect(await loadEarlierRunOutput("u1", "w1", "r-other")).toBeNull();
    const call = fake.calls[0];
    expect(call && filterValue(call, "eq", "user_id")).toBe("u1");
    expect(call && filterValue(call, "eq", "workflow_id")).toBe("w1");
  });
});
