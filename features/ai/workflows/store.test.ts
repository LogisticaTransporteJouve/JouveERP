import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  filterValue,
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

let respond: (call: RecordedCall) => {
  data: unknown;
  error: unknown;
  count?: number;
} = () => ({ data: null, error: null });
const fake = recordingSupabase((call) => respond(call));

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));

const {
  MAX_ACTIVE_WORKFLOWS_PER_USER,
  WorkflowLimitError,
  createWorkflow,
  deleteWorkflow,
  listRuns,
  setWorkflowActive,
} = await import("./store");

const NOW = new Date("2026-10-16T12:00:00Z");
const draft = {
  title: "Cobranzas",
  prompt: "Resumime las cobranzas vencidas.",
  cadence: "weekly" as const,
  runTime: "08:00",
  weekday: "1" as const,
  monthDay: null,
};

beforeEach(() => {
  fake.calls.length = 0;
  respond = (call) =>
    call.op === "select" && call.options
      ? { data: null, error: null, count: 0 }
      : { data: { id: "w1" }, error: null };
});

describe("workflow store", () => {
  it("creates the task for its owner with the first occurrence after now", async () => {
    await createWorkflow("u1", draft, NOW);
    const insert = fake.calls.find((c) => c.op === "insert");
    expect(insert?.payload).toMatchObject({
      user_id: "u1",
      cadence: "weekly",
      run_hour: 8,
      run_minute: 0,
      weekday: 1,
      month_day: null,
      next_run_at: "2026-10-19T11:00:00.000Z",
    });
  });

  it("maps the trigger's active-cap refusal on create and on resume", async () => {
    const capError = {
      code: "23514",
      message: "ai_workflows: active limit reached",
    };
    respond = (call) =>
      call.op === "select" && call.table === "ai_workflows" && !call.payload
        ? {
            data: {
              cadence: "daily",
              run_hour: 9,
              run_minute: 30,
              weekday: null,
              month_day: null,
            },
            error: null,
          }
        : { data: null, error: capError };
    await expect(createWorkflow("u1", draft, NOW)).rejects.toBeInstanceOf(
      WorkflowLimitError,
    );
    await expect(
      setWorkflowActive("u1", "w1", true, NOW),
    ).rejects.toBeInstanceOf(WorkflowLimitError);
    expect(MAX_ACTIVE_WORKFLOWS_PER_USER).toBe(10);
  });

  it("passes other database errors through", async () => {
    const other = { code: "23514", message: "ai_workflows_schedule_shape" };
    respond = () => ({ data: null, error: other });
    await expect(createWorkflow("u1", draft, NOW)).rejects.toBe(other);
  });

  it("filters every read and write by the owner", async () => {
    respond = (call) =>
      call.op === "select" && call.table === "ai_workflows"
        ? {
            data: {
              cadence: "daily",
              run_hour: 9,
              run_minute: 30,
              weekday: null,
              month_day: null,
            },
            error: null,
          }
        : { data: [{ id: "w1" }], error: null };
    await setWorkflowActive("u1", "w1", true, NOW);
    await deleteWorkflow("u1", "w1");
    await listRuns("u1", "w1");
    for (const call of fake.calls) {
      expect(filterValue(call, "eq", "user_id"), call.op).toBe("u1");
    }
    const resume = fake.calls.find((c) => c.op === "update");
    expect(resume?.payload).toEqual({
      is_active: true,
      next_run_at: "2026-10-16T12:30:00.000Z",
    });
  });

  it("does not resume another user's task", async () => {
    respond = () => ({ data: null, error: null });
    expect(await setWorkflowActive("u1", "w-other", true, NOW)).toBe(false);
    expect(fake.calls.some((c) => c.op === "update")).toBe(false);
  });
});
