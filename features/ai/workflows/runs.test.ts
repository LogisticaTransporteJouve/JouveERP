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

const {
  claimRun,
  completeRun,
  failRun,
  materializeDueRuns,
  planDueRuns,
  skipRun,
} = await import("./runs");

const NOW = new Date("2026-10-19T11:07:00Z");
const mondays = {
  cadence: "weekly" as const,
  runHour: 8,
  runMinute: 0,
  weekday: 1,
  monthDay: null,
};

beforeEach(() => {
  fake.calls.length = 0;
  respond = () => ({ data: null, error: null });
});

describe("planDueRuns", () => {
  it("plans one run for the due occurrence and the next one after now", () => {
    expect(
      planDueRuns(
        [
          {
            id: "w1",
            userId: "u1",
            schedule: mondays,
            nextRunAt: "2026-10-19T11:00:00Z",
          },
        ],
        NOW,
      ),
    ).toEqual([
      {
        workflowId: "w1",
        userId: "u1",
        scheduledFor: "2026-10-19T11:00:00.000Z",
        nextRunAt: "2026-10-26T11:00:00.000Z",
      },
    ]);
  });

  it("collapses missed occurrences into one run and skips what is not due", () => {
    const planned = planDueRuns(
      [
        {
          id: "late",
          userId: "u1",
          schedule: mondays,
          nextRunAt: "2026-09-28T11:00:00Z",
        },
        {
          id: "future",
          userId: "u1",
          schedule: mondays,
          nextRunAt: "2026-10-26T11:00:00Z",
        },
      ],
      NOW,
    );
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({
      workflowId: "late",
      scheduledFor: "2026-09-28T11:00:00.000Z",
      nextRunAt: "2026-10-26T11:00:00.000Z",
    });
  });
});

describe("materializeDueRuns", () => {
  const due = {
    id: "w1",
    user_id: "u1",
    cadence: "weekly",
    run_hour: 8,
    run_minute: 0,
    weekday: 1,
    month_day: null,
    next_run_at: "2026-10-19T11:00:00+00:00",
  };

  beforeEach(() => {
    respond = (call) => {
      if (call.table === "ai_workflows" && call.op === "select") {
        return { data: [due], error: null };
      }
      if (
        call.table === "ai_workflow_runs" &&
        call.op === "select" &&
        filterValue(call, "eq", "status") === "succeeded"
      ) {
        return { data: { id: "prev" }, error: null };
      }
      if (call.table === "ai_workflow_runs" && call.op === "select") {
        return { data: [{ id: "r1", user_id: "u1" }], error: null };
      }
      return { data: null, error: null };
    };
  });

  it("queues the occurrence idempotently, with memory, and advances by compare-and-set", async () => {
    const queued = await materializeDueRuns(NOW);
    expect(queued).toEqual([{ runId: "r1", userId: "u1" }]);

    const upsert = fake.calls.find((c) => c.op === "upsert");
    expect(upsert?.payload).toEqual({
      workflow_id: "w1",
      user_id: "u1",
      scheduled_for: "2026-10-19T11:00:00.000Z",
      previous_run_id: "prev",
    });
    expect(upsert?.options).toEqual({
      onConflict: "workflow_id,scheduled_for",
      ignoreDuplicates: true,
    });

    const advance = fake.calls.find(
      (c) => c.table === "ai_workflows" && c.op === "update",
    );
    expect(advance?.payload).toEqual({
      next_run_at: "2026-10-26T11:00:00.000Z",
    });
    expect(advance && filterValue(advance, "eq", "next_run_at")).toBe(
      "2026-10-19T11:00:00.000Z",
    );

    const select = fake.calls.find(
      (c) => c.table === "ai_workflows" && c.op === "select",
    );
    expect(select && filterValue(select, "eq", "is_active")).toBe(true);
    expect(select && filterValue(select, "lte", "next_run_at")).toBe(
      NOW.toISOString(),
    );
  });

  it("closes runs left queued past the re-send window", async () => {
    await materializeDueRuns(NOW);
    const expire = fake.calls.find(
      (c) => c.table === "ai_workflow_runs" && c.op === "update",
    );
    expect(expire?.payload).toMatchObject({
      status: "skipped",
      skip_reason: "expired",
    });
    expect(expire && filterValue(expire, "eq", "status")).toBe("queued");
    expect(expire && filterValue(expire, "lt", "scheduled_for")).toBe(
      "2026-10-18T12:07:00.000Z",
    );
  });

  it("produces the same writes when a retried step runs it again", async () => {
    await materializeDueRuns(NOW);
    const first = fake.calls.filter((c) => c.op !== "select");
    fake.calls.length = 0;
    await materializeDueRuns(NOW);
    const second = fake.calls.filter((c) => c.op !== "select");
    expect(second).toEqual(first);
  });

  it("throws on a read error so Inngest retries the step", async () => {
    respond = () => ({ data: null, error: { message: "down" } });
    await expect(materializeDueRuns(NOW)).rejects.toBeTruthy();
  });
});

describe("run transitions", () => {
  beforeEach(() => {
    respond = () => ({ data: [{ id: "r1" }], error: null });
  });

  it("claims only a queued run", async () => {
    expect(await claimRun("r1", NOW)).toBe(true);
    const call = fake.calls[0];
    expect(call && filterValue(call, "in", "status")).toEqual(["queued"]);
    expect(call?.payload).toMatchObject({ status: "running" });
  });

  it("completes only a running run and fails only an unfinished one", async () => {
    await completeRun(
      "r1",
      { output: "ok", summary: "s", toolNames: ["getClientAging"] },
      NOW,
    );
    await failRun("r1", "x".repeat(900), NOW);
    await skipRun("r1", "daily_cap", NOW);
    const [complete, fail, skip] = fake.calls;
    expect(complete && filterValue(complete, "in", "status")).toEqual([
      "running",
    ]);
    expect(fail && filterValue(fail, "in", "status")).toEqual([
      "queued",
      "running",
    ]);
    expect(String(Reflect.get(Object(fail?.payload), "error"))).toHaveLength(
      500,
    );
    expect(skip && filterValue(skip, "in", "status")).toEqual([
      "queued",
      "running",
    ]);
  });

  it("reports a lost race as false", async () => {
    respond = () => ({ data: [], error: null });
    expect(await claimRun("r1", NOW)).toBe(false);
  });
});
