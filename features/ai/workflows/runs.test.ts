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
  expireAndListQueuedRuns,
  failRun,
  listWorkflowsToSchedule,
  queueOccurrence,
  skipRun,
  staleReason,
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

const due = {
  id: "w1",
  userId: "u1",
  schedule: mondays,
  isActive: true,
  nextRunAt: "2026-10-19T11:00:00+00:00",
  version: "v1",
};

describe("staleReason", () => {
  const expected = { nextRunAt: "2026-10-19T11:00:00.000Z", version: "v1" };

  it("lets through the task it was scheduled as (instants compared, not strings)", () => {
    expect(staleReason(due, expected)).toBeNull();
  });

  it("names a deleted, paused, re-versioned or rescheduled task", () => {
    expect(staleReason(null, expected)).toBe("deleted");
    expect(staleReason({ ...due, isActive: false }, expected)).toBe("paused");
    expect(staleReason({ ...due, version: "v2" }, expected)).toBe("changed");
    expect(
      staleReason({ ...due, nextRunAt: "2026-10-26T11:00:00Z" }, expected),
    ).toBe("changed");
  });
});

describe("queueOccurrence", () => {
  let advanced: unknown[];
  let current: unknown;

  beforeEach(() => {
    advanced = [{ next_run_at: "2026-10-26T11:00:00+00:00", updated_at: "v2" }];
    current = null;
    respond = (call) => {
      if (call.table === "ai_workflows" && call.op === "update") {
        return { data: advanced, error: null };
      }
      if (call.table === "ai_workflows" && call.op === "select") {
        return { data: current, error: null };
      }
      if (
        call.table === "ai_workflow_runs" &&
        call.op === "select" &&
        filterValue(call, "eq", "status") === "succeeded"
      ) {
        return { data: { id: "prev" }, error: null };
      }
      if (call.table === "ai_workflow_runs" && call.op === "select") {
        return {
          data: { id: "r1", user_id: "u1", status: "queued" },
          error: null,
        };
      }
      return { data: null, error: null };
    };
  });

  it("queues the occurrence idempotently, with memory, and advances by compare-and-set", async () => {
    expect(await queueOccurrence(due, NOW)).toEqual({
      run: { runId: "r1", userId: "u1" },
      next: { nextRunAt: "2026-10-26T11:00:00+00:00", version: "v2" },
    });

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
    expect(advance && filterValue(advance, "eq", "is_active")).toBe(true);
  });

  it("collapses missed occurrences: the next one is computed from now", async () => {
    await queueOccurrence({ ...due, nextRunAt: "2026-09-28T11:00:00Z" }, NOW);
    const upsert = fake.calls.find((c) => c.op === "upsert");
    expect(Reflect.get(Object(upsert?.payload), "scheduled_for")).toBe(
      "2026-09-28T11:00:00.000Z",
    );
    const advance = fake.calls.find(
      (c) => c.table === "ai_workflows" && c.op === "update",
    );
    expect(advance?.payload).toEqual({
      next_run_at: "2026-10-26T11:00:00.000Z",
    });
  });

  it("hands back the version a retried step or a twin already advanced to", async () => {
    advanced = [];
    current = {
      id: "w1",
      user_id: "u1",
      cadence: "weekly",
      run_hour: 8,
      run_minute: 0,
      weekday: 1,
      month_day: null,
      is_active: true,
      next_run_at: "2026-10-26T11:00:00+00:00",
      updated_at: "v2",
    };
    expect((await queueOccurrence(due, NOW)).next).toEqual({
      nextRunAt: "2026-10-26T11:00:00+00:00",
      version: "v2",
    });
  });

  it("does not reschedule a task another writer moved, paused or deleted", async () => {
    advanced = [];
    for (const row of [
      null,
      { is_active: false, next_run_at: "2026-10-26T11:00:00+00:00" },
      { is_active: true, next_run_at: "2026-10-20T11:00:00+00:00" },
    ]) {
      current = row && {
        id: "w1",
        user_id: "u1",
        cadence: "weekly",
        run_hour: 8,
        run_minute: 0,
        weekday: 1,
        month_day: null,
        updated_at: "v9",
        ...row,
      };
      expect((await queueOccurrence(due, NOW)).next).toBeNull();
    }
  });

  it("does not send a run that is no longer queued", async () => {
    const prior = respond;
    respond = (call) =>
      call.table === "ai_workflow_runs" &&
      call.op === "select" &&
      filterValue(call, "eq", "scheduled_for")
        ? {
            data: { id: "r1", user_id: "u1", status: "succeeded" },
            error: null,
          }
        : prior(call);
    expect((await queueOccurrence(due, NOW)).run).toBeNull();
  });

  it("produces the same writes when a retried step runs it again", async () => {
    await queueOccurrence(due, NOW);
    const first = fake.calls.filter((c) => c.op !== "select");
    fake.calls.length = 0;
    await queueOccurrence(due, NOW);
    expect(fake.calls.filter((c) => c.op !== "select")).toEqual(first);
  });

  it("throws on a write error so Inngest retries the step", async () => {
    respond = () => ({ data: null, error: { message: "down" } });
    await expect(queueOccurrence(due, NOW)).rejects.toBeTruthy();
  });
});

describe("listWorkflowsToSchedule", () => {
  it("reads active tasks due before the horizon, past ones included", async () => {
    respond = () => ({
      data: [
        {
          id: "w1",
          user_id: "u1",
          cadence: "weekly",
          run_hour: 8,
          run_minute: 0,
          weekday: 1,
          month_day: null,
          is_active: true,
          next_run_at: "2026-10-19T11:00:00+00:00",
          updated_at: "v1",
        },
      ],
      error: null,
    });
    const until = new Date("2026-10-20T13:07:00Z");
    expect(await listWorkflowsToSchedule(until)).toEqual([due]);
    const select = fake.calls[0];
    expect(select && filterValue(select, "eq", "is_active")).toBe(true);
    expect(select && filterValue(select, "lte", "next_run_at")).toBe(
      until.toISOString(),
    );
    expect(select && filterValue(select, "gte", "next_run_at")).toBeUndefined();
  });
});

describe("expireAndListQueuedRuns", () => {
  it("closes runs queued past the re-send window and returns the recent ones", async () => {
    respond = (call) =>
      call.op === "select"
        ? { data: [{ id: "r1", user_id: "u1" }], error: null }
        : { data: null, error: null };
    expect(await expireAndListQueuedRuns(NOW)).toEqual([
      { runId: "r1", userId: "u1" },
    ]);
    const [expire, resend] = fake.calls;
    expect(expire?.payload).toMatchObject({
      status: "skipped",
      skip_reason: "expired",
    });
    // Keyed on when the run was queued, so a catch-up run for an old
    // occurrence (queued just now) is sent, not expired.
    expect(expire && filterValue(expire, "lt", "created_at")).toBe(
      "2026-10-18T12:07:00.000Z",
    );
    expect(resend && filterValue(resend, "gte", "created_at")).toBe(
      "2026-10-18T12:07:00.000Z",
    );
    expect(resend && filterValue(resend, "eq", "status")).toBe("queued");
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
