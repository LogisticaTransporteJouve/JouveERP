import { InngestTestEngine } from "@inngest/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runs = {
  loadScheduledWorkflow: vi.fn(),
  queueOccurrence: vi.fn(),
  staleReason: vi.fn(),
  expireAndListQueuedRuns: vi.fn(),
  listWorkflowsToSchedule: vi.fn(),
};
vi.mock("@/features/ai/workflows/runs", async (importOriginal) => ({
  ...runs,
  staleReason: (
    await importOriginal<typeof import("@/features/ai/workflows/runs")>()
  ).staleReason,
}));

const { aiWorkflowScheduler, sleepHops, MAX_SLEEP_MS } =
  await import("./ai-workflow-scheduler");
const { aiWorkflowsReconcile, RECONCILE_HORIZON_MS, reconcileEvent } =
  await import("./ai-workflows-reconcile");

const WF = "3f0c9a9e-5a51-4c55-9b0e-0b7d1c1c2a10";
const USER = "8b5d3c7e-1f2a-4b3c-9d4e-5f6a7b8c9d0e";
const RUN = "6a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DUE = "2026-11-09T11:00:00.000Z";
const V1 = "2026-11-04T12:00:00.123456+00:00";
const SENT_AT = Date.parse("2026-11-04T12:00:01Z");

const workflow = {
  id: WF,
  userId: USER,
  schedule: {
    cadence: "weekly" as const,
    runHour: 8,
    runMinute: 0,
    weekday: 1,
    monthDay: null,
  },
  isActive: true,
  nextRunAt: "2026-11-09T11:00:00+00:00",
  version: V1,
};

const scheduled = {
  name: "ai/workflow.scheduled",
  ts: SENT_AT,
  data: { workflow_id: WF, next_run_at: DUE, version: V1 },
} as const;

// step.sendEvent reaches the Inngest API, so tests stub those steps by id. A
// fresh engine per execution: mocked step results are cached per engine.
const sent = (...ids: string[]) =>
  ids.map((id) => ({ id, handler: () => ({ ids: [] }) }));

function engine() {
  return new InngestTestEngine({
    function: aiWorkflowScheduler,
    events: [scheduled],
    steps: [
      ...sent("request-run", "schedule-next"),
      ...sent("sleep-0", "sleep-1", "sleep-2", "sleep-3", "sleep-4"),
    ],
  });
}

function reconcile() {
  return new InngestTestEngine({
    function: aiWorkflowsReconcile,
    steps: sent("resend-runs", "schedule"),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  runs.loadScheduledWorkflow.mockResolvedValue(workflow);
  runs.queueOccurrence.mockResolvedValue({
    run: { runId: RUN, userId: USER },
    next: { nextRunAt: "2026-11-16T11:00:00+00:00", version: "v2" },
  });
});

describe("ai-workflow-scheduler", () => {
  it("sleeps until next_run_at, queues the run once and schedules the next occurrence", async () => {
    const { result, ctx } = await engine().execute();
    expect(ctx.step.sleepUntil).toHaveBeenCalledTimes(1);
    expect(ctx.step.sleepUntil).toHaveBeenCalledWith("sleep-0", new Date(DUE));
    expect(runs.queueOccurrence).toHaveBeenCalledOnce();
    expect(ctx.step.sendEvent).toHaveBeenCalledWith("request-run", {
      id: `ai-workflow-run-${RUN}`,
      name: "ai/workflow-run.requested",
      data: { run_id: RUN, user_id: USER },
    });
    expect(ctx.step.sendEvent).toHaveBeenCalledWith("schedule-next", {
      id: `ai-workflow-scheduled-${WF}-v2`,
      name: "ai/workflow.scheduled",
      data: {
        workflow_id: WF,
        next_run_at: "2026-11-16T11:00:00+00:00",
        version: "v2",
      },
    });
    expect(result).toEqual({
      queued: true,
      nextRunAt: "2026-11-16T11:00:00+00:00",
    });
  });

  it("cancels on a change of the same task with another version only", () => {
    const opts = Reflect.get(Object(aiWorkflowScheduler), "opts");
    expect(opts.cancelOn).toEqual([
      {
        event: "ai/workflow.changed",
        if: "async.data.workflow_id == event.data.workflow_id && async.data.version != event.data.version",
      },
    ]);
    expect(opts.cancelOn[0].match).toBeUndefined();
  });

  it.each([
    ["deleted", null],
    ["paused", { ...workflow, isActive: false }],
    ["changed", { ...workflow, version: "newer" }],
    ["changed", { ...workflow, nextRunAt: "2026-11-10T11:00:00Z" }],
  ])(
    "exits without queuing when the task was %s after the sleep began",
    async (reason, current) => {
      runs.loadScheduledWorkflow.mockResolvedValue(current);
      const { result, ctx } = await engine().execute();
      expect(result).toEqual({ queued: false, stale: reason });
      expect(runs.queueOccurrence).not.toHaveBeenCalled();
      expect(ctx.step.sendEvent).not.toHaveBeenCalled();
    },
  );

  it("does not reschedule when another writer moved the task", async () => {
    runs.queueOccurrence.mockResolvedValue({ run: null, next: null });
    const { result, ctx } = await engine().execute();
    expect(result).toEqual({ queued: false, nextRunAt: null });
    expect(ctx.step.sendEvent).not.toHaveBeenCalled();
  });

  it("sleeps a monthly occurrence in hops under the 7-day cap", async () => {
    const due = "2026-12-01T11:00:00.000Z";
    const { ctx } = await engine().execute({
      events: [{ ...scheduled, data: { ...scheduled.data, next_run_at: due } }],
    });
    const calls = vi.mocked(ctx.step.sleepUntil).mock.calls;
    expect(calls.map((c) => c[0])).toEqual([
      "sleep-0",
      "sleep-1",
      "sleep-2",
      "sleep-3",
      "sleep-4",
    ]);
    expect(calls.at(-1)?.[1]).toEqual(new Date(due));
  });
});

describe("sleepHops", () => {
  it("keeps every hop at most MAX_SLEEP_MS and ends at the target", () => {
    const target = new Date(SENT_AT + 20 * 24 * 3600 * 1000);
    const hops = sleepHops(SENT_AT, target);
    let from = SENT_AT;
    for (const hop of hops) {
      expect(hop.getTime() - from).toBeLessThanOrEqual(MAX_SLEEP_MS);
      from = hop.getTime();
    }
    expect(hops.at(-1)).toEqual(target);
    expect(MAX_SLEEP_MS).toBeLessThan(7 * 24 * 3600 * 1000);
  });

  it("is a single sleep for a past or near target", () => {
    expect(sleepHops(SENT_AT, new Date(SENT_AT - 1000))).toHaveLength(1);
  });
});

describe("ai-workflows-reconcile", () => {
  it("re-sends queued runs and schedules every active task due before the next pass", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T07:52:00Z"));
    runs.expireAndListQueuedRuns.mockResolvedValue([
      { runId: RUN, userId: USER },
    ]);
    runs.listWorkflowsToSchedule.mockResolvedValue([workflow]);
    const { result, ctx } = await reconcile().execute();
    vi.useRealTimers();
    expect(runs.listWorkflowsToSchedule).toHaveBeenCalledWith(
      new Date(Date.parse("2026-11-04T07:52:00Z") + RECONCILE_HORIZON_MS),
    );
    expect(ctx.step.sendEvent).toHaveBeenCalledWith("resend-runs", [
      {
        id: `ai-workflow-run-${RUN}`,
        name: "ai/workflow-run.requested",
        data: { run_id: RUN, user_id: USER },
      },
    ]);
    expect(ctx.step.sendEvent).toHaveBeenCalledWith("schedule", [
      {
        id: `ai-workflow-scheduled-${WF}-${V1}`,
        name: "ai/workflow.scheduled",
        data: {
          workflow_id: WF,
          next_run_at: workflow.nextRunAt,
          version: V1,
        },
      },
    ]);
    expect(result).toEqual({ resent: 1, scheduled: 1 });
  });

  it("gives an overdue task an id of its own, past the dedupe of its original schedule", () => {
    const pass = Date.parse("2026-11-10T07:52:00Z");
    expect(reconcileEvent(workflow, pass).id).toBe(
      `ai-workflow-scheduled-${WF}-${V1}-reconcile-2026-11-10`,
    );
    expect(
      reconcileEvent(workflow, Date.parse("2026-11-09T07:52:00Z")).id,
    ).toBe(`ai-workflow-scheduled-${WF}-${V1}`);
  });

  it("sends nothing when nothing is queued or due", async () => {
    runs.expireAndListQueuedRuns.mockResolvedValue([]);
    runs.listWorkflowsToSchedule.mockResolvedValue([]);
    const { ctx } = await reconcile().execute();
    expect(ctx.step.sendEvent).not.toHaveBeenCalled();
  });

  it("runs once a day, outside 6–9 AM Pacific", () => {
    const opts = Reflect.get(Object(aiWorkflowsReconcile), "opts");
    expect(opts.triggers).toEqual([
      { cron: "TZ=America/Argentina/Buenos_Aires 52 4 * * *" },
    ]);
  });
});
