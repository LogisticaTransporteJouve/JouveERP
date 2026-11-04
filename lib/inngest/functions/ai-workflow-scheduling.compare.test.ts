// Executes the candidate designs for scheduling AI tasks over simulated days
// (tests/helpers/inngest-sim.ts models the Inngest semantics they depend on):
//   A  the 15-minute poll cron that ran until 2026-11 (baseline);
//   B  ai-workflow-scheduler alone: sleepUntil + cancelOn, self-sent chain;
//   C  events sent with `ts` = next_run_at (no cancel; stale ones exit);
//   D  B + the daily ai-workflows-reconcile (what ships).
// The store is an in-memory model of features/ai/workflows/runs.ts with the
// same idempotency (unique occurrence, compare-and-set advance); the SQL side
// is covered in runs.test.ts. `ai-workflow-run` is a stub with its real
// trigger and idempotency key that records each execution.
import { randomUUID } from "node:crypto";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { nextRunAt } from "@/features/ai/workflows/schedule";
import type { WorkflowSchedule } from "@/features/ai/workflows/schema";
import { InngestSim, type FnStats } from "@/tests/helpers/inngest-sim";

type Wf = {
  id: string;
  userId: string;
  schedule: WorkflowSchedule;
  isActive: boolean;
  nextRunAt: string;
  version: string;
};
type RunRow = {
  id: string;
  workflowId: string;
  userId: string;
  scheduledFor: string;
  status: "queued" | "succeeded" | "skipped";
  createdAt: number;
};

const db = {
  workflows: new Map<string, Wf>(),
  runs: new Map<string, RunRow>(),
  executions: [] as { workflowId: string; scheduledFor: string; at: number }[],
  failQueue: 0,
  counter: 0,
  reset() {
    this.workflows.clear();
    this.runs.clear();
    this.executions = [];
    this.failQueue = 0;
  },
  bump(): string {
    return `${new Date().toISOString()}#${++this.counter}`;
  },
};

const USER = "8b5d3c7e-1f2a-4b3c-9d4e-5f6a7b8c9d0e";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const RESEND_WINDOW_MS = 23 * HOUR;

function queueOccurrence(w: Wf, now: Date) {
  if (db.failQueue > 0) {
    db.failQueue--;
    throw new Error("db down");
  }
  const scheduledFor = new Date(w.nextRunAt).toISOString();
  const nextAt = nextRunAt(w.schedule, now).toISOString();
  const key = `${w.id}|${scheduledFor}`;
  if (!db.runs.has(key)) {
    db.runs.set(key, {
      id: randomUUID(),
      workflowId: w.id,
      userId: w.userId,
      scheduledFor,
      status: "queued",
      createdAt: now.getTime(),
    });
  }
  const run = db.runs.get(key);
  const row = db.workflows.get(w.id);
  let next: { nextRunAt: string; version: string } | null = null;
  if (row?.isActive && Date.parse(row.nextRunAt) === Date.parse(scheduledFor)) {
    row.nextRunAt = nextAt;
    row.version = db.bump();
    next = { nextRunAt: row.nextRunAt, version: row.version };
  } else if (
    row?.isActive &&
    Date.parse(row.nextRunAt) === Date.parse(nextAt)
  ) {
    next = { nextRunAt: row.nextRunAt, version: row.version };
  }
  return {
    run:
      run?.status === "queued" ? { runId: run.id, userId: run.userId } : null,
    next,
  };
}

function expireAndListQueuedRuns(now: Date) {
  const from = now.getTime() - RESEND_WINDOW_MS;
  const queued: { runId: string; userId: string }[] = [];
  for (const run of db.runs.values()) {
    if (run.status !== "queued") continue;
    if (run.createdAt < from) run.status = "skipped";
    else queued.push({ runId: run.id, userId: run.userId });
  }
  return queued;
}

vi.mock("@/features/ai/workflows/runs", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/features/ai/workflows/runs")>();
  return {
    staleReason: real.staleReason,
    loadScheduledWorkflow: async (id: string) => {
      const row = db.workflows.get(id);
      return row ? { ...row } : null;
    },
    queueOccurrence: async (w: Wf, now: Date) => queueOccurrence(w, now),
    listWorkflowsToSchedule: async (until: Date) =>
      [...db.workflows.values()]
        .filter((w) => w.isActive && Date.parse(w.nextRunAt) <= until.getTime())
        .map((w) => ({ ...w })),
    expireAndListQueuedRuns: async (now: Date) => expireAndListQueuedRuns(now),
  };
});

let sim: InngestSim | null = null;
function currentSim(): InngestSim {
  if (!sim) throw new Error("no sim");
  return sim;
}

const { inngest } = await import("@/lib/inngest/client");
vi.spyOn(inngest, "send").mockImplementation(async (payload: unknown) =>
  currentSim().send(payload),
);

const { aiWorkflowScheduler } = await import("./ai-workflow-scheduler");
const { aiWorkflowsReconcile } = await import("./ai-workflows-reconcile");
const { announceWorkflowChange, scheduledEvent, DELETED_VERSION } =
  await import("@/features/ai/workflows/scheduling");
const {
  AI_WORKFLOW_CHANGED,
  AI_WORKFLOW_RUN_REQUESTED,
  AI_WORKFLOW_SCHEDULED,
  AiWorkflowRunRequestedSchema,
  AiWorkflowScheduledSchema,
} = await import("@/lib/inngest/events");

const runStub = inngest.createFunction(
  {
    id: "ai-workflow-run",
    triggers: [{ event: AI_WORKFLOW_RUN_REQUESTED }],
    idempotency: "event.data.run_id",
    retries: 1,
  },
  async ({ event, step }) => {
    const { run_id: runId } = AiWorkflowRunRequestedSchema.parse(event.data);
    return step.run("claim", () => {
      const run = [...db.runs.values()].find((r) => r.id === runId);
      if (!run || run.status !== "queued") return { claimed: false };
      run.status = "succeeded";
      db.executions.push({
        workflowId: run.workflowId,
        scheduledFor: run.scheduledFor,
        at: Date.now(),
      });
      return { claimed: true };
    });
  },
);

const pollA = inngest.createFunction(
  {
    id: "cand-a-poll",
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires */15 * * * *" }],
    retries: 2,
  },
  async ({ step }) => {
    const queued = await step.run("materialize", () => {
      const now = new Date();
      for (const w of db.workflows.values()) {
        if (w.isActive && Date.parse(w.nextRunAt) <= now.getTime()) {
          queueOccurrence(w, now);
        }
      }
      return expireAndListQueuedRuns(now);
    });
    if (queued.length > 0) {
      await step.sendEvent(
        "fan-out-runs",
        queued.map((r) => ({
          id: `ai-workflow-run-${r.runId}`,
          name: AI_WORKFLOW_RUN_REQUESTED,
          data: { run_id: r.runId, user_id: r.userId },
        })),
      );
    }
  },
);

const C_DUE = "cand-c/workflow.due";
function dueEvent(w: { id: string; nextRunAt: string; version: string }) {
  return {
    id: `cand-c-${w.id}-${w.version}`,
    name: C_DUE,
    ts: Date.parse(w.nextRunAt),
    data: { workflow_id: w.id, next_run_at: w.nextRunAt, version: w.version },
  };
}

const deliveryC = inngest.createFunction(
  { id: "cand-c-delivery", triggers: [{ event: C_DUE }], retries: 3 },
  async ({ event, step }) => {
    const data = AiWorkflowScheduledSchema.parse(event.data);
    const { staleReason } = await import("@/features/ai/workflows/runs");
    const check = await step.run("check", () => {
      const row = db.workflows.get(data.workflow_id) ?? null;
      const stale = staleReason(row, {
        nextRunAt: data.next_run_at,
        version: data.version,
      });
      return stale || !row ? { stale: stale ?? "deleted" } : { row };
    });
    if (!("row" in check)) return { stale: check.stale };
    const occ = await step.run("queue", () =>
      queueOccurrence(check.row, new Date()),
    );
    if (occ.run) {
      await step.sendEvent("request-run", {
        id: `ai-workflow-run-${occ.run.runId}`,
        name: AI_WORKFLOW_RUN_REQUESTED,
        data: { run_id: occ.run.runId, user_id: occ.run.userId },
      });
    }
    if (occ.next) {
      await step.sendEvent(
        "schedule-next",
        dueEvent({ id: data.workflow_id, ...occ.next }),
      );
    }
    return { queued: occ.run !== null };
  },
);

// B in one long-lived run: a new step id per occurrence (the rejected loop).
const loopB = inngest.createFunction(
  {
    id: "cand-b-loop",
    triggers: [{ event: AI_WORKFLOW_SCHEDULED }],
    cancelOn: [
      {
        event: AI_WORKFLOW_CHANGED,
        if: "async.data.workflow_id == event.data.workflow_id && async.data.version != event.data.version",
      },
    ],
  },
  async ({ event, step }) => {
    const first = AiWorkflowScheduledSchema.parse(event.data);
    let expected = { nextRunAt: first.next_run_at, version: first.version };
    const { staleReason } = await import("@/features/ai/workflows/runs");
    for (let i = 0; ; i++) {
      await step.sleepUntil(`sleep-${i}`, new Date(expected.nextRunAt));
      const check = await step.run(`check-${i}`, () => {
        const row = db.workflows.get(first.workflow_id) ?? null;
        const stale = staleReason(row, expected);
        return stale || !row ? { stale: stale ?? "deleted" } : { row };
      });
      if (!("row" in check)) return { stale: check.stale, occurrences: i };
      const occ = await step.run(`queue-${i}`, () =>
        queueOccurrence(check.row, new Date()),
      );
      if (occ.run) {
        await step.sendEvent(`request-run-${i}`, {
          id: `ai-workflow-run-${occ.run.runId}`,
          name: AI_WORKFLOW_RUN_REQUESTED,
          data: { run_id: occ.run.runId, user_id: occ.run.userId },
        });
      }
      if (!occ.next) return { occurrences: i + 1 };
      expected = occ.next;
    }
  },
);

// The scheduler with `match` instead of the `if` it ships with.
const schedulerHandler: unknown = Reflect.get(
  Object(aiWorkflowScheduler),
  "fn",
);
const matchOnlyScheduler = inngest.createFunction(
  {
    id: "variant-match-only",
    triggers: [{ event: AI_WORKFLOW_SCHEDULED }],
    cancelOn: [{ event: AI_WORKFLOW_CHANGED, match: "data.workflow_id" }],
  },
  (ctx) => {
    if (typeof schedulerHandler !== "function") throw new Error("no handler");
    return Reflect.apply(schedulerHandler, undefined, [ctx]);
  },
);

type Option = "A" | "B" | "C" | "D";
const FUNCTIONS: Record<Option, unknown[]> = {
  A: [pollA, runStub],
  B: [aiWorkflowScheduler, runStub],
  C: [deliveryC, runStub],
  D: [aiWorkflowScheduler, aiWorkflowsReconcile, runStub],
};
const SCHEDULER_ID: Record<Option, string> = {
  A: "cand-a-poll",
  B: "ai-workflow-scheduler",
  C: "cand-c-delivery",
  D: "ai-workflow-scheduler",
};

// Wednesday 2026-11-04 09:00 in Buenos Aires.
const START = Date.parse("2026-11-04T12:00:00Z");
const at10 = (day: number) => START + day * DAY + HOUR; // 10:00 ART

const daily = (hour: number, minute = 0): WorkflowSchedule => ({
  cadence: "daily",
  runHour: hour,
  runMinute: minute,
  weekday: null,
  monthDay: null,
});

function setup(option: Option, functions = FUNCTIONS[option]) {
  db.reset();
  sim = new InngestSim(functions, START, (t) => vi.setSystemTime(t));
  const s = sim;
  let lastAnnounce: () => Promise<void> = async () => undefined;

  const announce = async (w: Wf | null, id: string) => {
    const send = async () => {
      if (option === "A") return;
      if (option === "C") {
        if (w?.isActive) await inngest.send(dueEvent(w));
        return;
      }
      await announceWorkflowChange(
        id,
        !w
          ? { active: false, version: DELETED_VERSION }
          : w.isActive
            ? { active: true, nextRunAt: w.nextRunAt, version: w.version }
            : { active: false, version: w.version },
      );
    };
    lastAnnounce = send;
    await send();
    await s.flush();
  };

  const row = (id: string): Wf => {
    const w = db.workflows.get(id);
    if (!w) throw new Error("no workflow");
    return w;
  };

  const ops = {
    async create(schedule: WorkflowSchedule): Promise<string> {
      const w: Wf = {
        id: randomUUID(),
        userId: USER,
        schedule,
        isActive: true,
        nextRunAt: nextRunAt(schedule, new Date()).toISOString(),
        version: db.bump(),
      };
      db.workflows.set(w.id, w);
      await announce({ ...w }, w.id);
      return w.id;
    },
    async edit(id: string, schedule: WorkflowSchedule) {
      const w = row(id);
      Object.assign(w, {
        schedule,
        nextRunAt: nextRunAt(schedule, new Date()).toISOString(),
        version: db.bump(),
      });
      await announce({ ...w }, id);
    },
    async pause(id: string) {
      Object.assign(row(id), { isActive: false, version: db.bump() });
      await announce({ ...row(id) }, id);
    },
    async resume(id: string) {
      const w = row(id);
      Object.assign(w, {
        isActive: true,
        nextRunAt: nextRunAt(w.schedule, new Date()).toISOString(),
        version: db.bump(),
      });
      await announce({ ...w }, id);
    },
    async remove(id: string) {
      db.workflows.delete(id);
      await announce(null, id);
    },
    async repeatLastAnnounce() {
      await lastAnnounce();
      await s.flush();
    },
  };
  return { sim: s, ops };
}

const lateness = () =>
  db.executions.map((e) => e.at - Date.parse(e.scheduledFor));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  sim = null;
});

const ALL: Option[] = ["A", "B", "C", "D"];

describe.each(ALL)("option %s", (option) => {
  it("fires exactly once per occurrence, at the due time", async () => {
    const { sim: s, ops } = setup(option);
    await ops.create(daily(10));
    await s.advanceTo(at10(0) - 1);
    expect(db.executions).toHaveLength(0);
    await s.advanceTo(at10(0) + 1);
    expect(db.executions).toHaveLength(1);
    await s.advanceTo(START + 3 * DAY);
    expect(db.executions.map((e) => e.scheduledFor)).toEqual([
      "2026-11-04T13:00:00.000Z",
      "2026-11-05T13:00:00.000Z",
      "2026-11-06T13:00:00.000Z",
    ]);
    expect(lateness()).toEqual([0, 0, 0]);
  });

  it("an edit before the due time drops the old occurrence and runs the new one", async () => {
    const { sim: s, ops } = setup(option);
    const id = await ops.create(daily(10));
    await s.advanceTo(START + HOUR / 2);
    await ops.edit(id, daily(11));
    await s.advanceTo(at10(0) + 30 * 60 * 1000);
    expect(db.executions).toHaveLength(0);
    await s.advanceTo(at10(0) + 2 * HOUR);
    expect(db.executions.map((e) => e.scheduledFor)).toEqual([
      "2026-11-04T14:00:00.000Z",
    ]);
    if (option === "B" || option === "D") {
      expect(s.stats.get("ai-workflow-scheduler")?.cancelled).toBe(1);
    }
    if (option === "C") {
      // No cancel: the old event still starts a run, which exits stale.
      expect(s.results("cand-c-delivery")).toContainEqual({ stale: "changed" });
    }
  });

  it("pause stops it and resume starts it again; delete stops it", async () => {
    const { sim: s, ops } = setup(option);
    const paused = await ops.create(daily(10));
    const deleted = await ops.create(daily(10, 15));
    await ops.pause(paused);
    await ops.remove(deleted);
    await s.advanceTo(START + 2 * DAY);
    expect(db.executions).toHaveLength(0);
    await ops.resume(paused);
    await s.advanceTo(START + 3 * DAY);
    expect(db.executions.map((e) => e.scheduledFor)).toEqual([
      "2026-11-06T13:00:00.000Z",
    ]);
  });

  it("a repeated create or edit (retried action) does not double-run", async () => {
    const { sim: s, ops } = setup(option);
    const id = await ops.create(daily(10));
    await ops.repeatLastAnnounce();
    await ops.repeatLastAnnounce();
    await ops.edit(id, daily(11));
    await ops.repeatLastAnnounce();
    await s.advanceTo(START + 2 * DAY);
    expect(db.executions).toHaveLength(2);
    if (option === "B" || option === "D") {
      expect(s.live(SCHEDULER_ID[option])).toBe(1);
    }
  });

  it("a step that throws is retried and still runs the occurrence once", async () => {
    const { sim: s, ops } = setup(option);
    await ops.create(daily(10));
    db.failQueue = 2;
    await s.advanceTo(START + DAY);
    expect(db.executions).toHaveLength(1);
    expect(lateness()[0]).toBeLessThanOrEqual(
      option === "A" ? 15 * 60 * 1000 : 60 * 1000,
    );
  });

  it("after retries run out or Inngest loses the schedule, only A and D recover", async () => {
    const { sim: s, ops } = setup(option);
    await ops.create(daily(10));
    await ops.create(daily(10, 30));
    db.failQueue = 4; // exhausts the scheduler's 3 retries on the first task
    await s.advanceTo(at10(0) + 5 * 60 * 1000);
    s.loseScheduledWork(); // the second task's sleep is gone
    await s.advanceTo(START + 3 * DAY);
    const recovered = { A: 6, B: 0, C: 0, D: 6 }[option];
    // A: the failed pass is retried by the next poll. D: the 04:52 reconcile
    // re-schedules both tasks; their 2026-11-04 occurrence runs late, at the
    // pass, and the rest on time.
    expect(db.executions).toHaveLength(recovered);
    if (option === "D") {
      const late = lateness().filter((ms) => ms > 0);
      expect(late).toHaveLength(2);
    }
  });
});

describe("option-specific evidence", () => {
  it("B/D: a lost cancel event is caught by the stale guard after the sleep", async () => {
    const { sim: s, ops } = setup("D");
    s.dropEvent = (e) => e.name === AI_WORKFLOW_CHANGED;
    const id = await ops.create(daily(10));
    await ops.pause(id);
    await s.advanceTo(START + DAY);
    expect(db.executions).toHaveLength(0);
    expect(s.results("ai-workflow-scheduler")).toContainEqual({
      queued: false,
      stale: "paused",
    });
  });

  it("B/D: twin schedulers of one version (re-sent past the dedupe window) run the occurrence once", async () => {
    const { sim: s, ops } = setup("B");
    const id = await ops.create(daily(10));
    const w = db.workflows.get(id);
    if (!w) throw new Error("no workflow");
    s.send({ ...scheduledEvent(w), id: "twin" });
    await s.advanceTo(START + 2 * DAY);
    expect(db.executions).toHaveLength(2);
    expect(s.live("ai-workflow-scheduler")).toBe(1);
  });

  it("`match` alone would let the change event cancel the new schedule it precedes", async () => {
    const { sim: s, ops } = setup("B", [matchOnlyScheduler, runStub]);
    const id = await ops.create(daily(10));
    // The resume's scheduled event is received before its changed event.
    s.dropEvent = () => false;
    await ops.pause(id);
    const w = db.workflows.get(id);
    if (!w) throw new Error("no workflow");
    Object.assign(w, { isActive: true, version: db.bump() });
    s.send(scheduledEvent(w));
    await s.flush();
    s.send({
      id: `late-changed-${w.version}`,
      name: AI_WORKFLOW_CHANGED,
      data: { workflow_id: id, version: w.version },
    });
    await s.advanceTo(START + DAY);
    expect(db.executions).toHaveLength(0);
  });

  it("the shipped `if` keeps that schedule alive", async () => {
    const { sim: s, ops } = setup("B");
    const id = await ops.create(daily(10));
    await ops.pause(id);
    const w = db.workflows.get(id);
    if (!w) throw new Error("no workflow");
    Object.assign(w, { isActive: true, version: db.bump() });
    s.send(scheduledEvent(w));
    await s.flush();
    s.send({
      id: `late-changed-${w.version}`,
      name: AI_WORKFLOW_CHANGED,
      data: { workflow_id: id, version: w.version },
    });
    await s.advanceTo(START + DAY);
    expect(db.executions).toHaveLength(1);
  });

  it("B as one looping run grows by ~5 steps per occurrence (toward the 1,000-step cap)", async () => {
    const { sim: s, ops } = setup("B", [loopB, runStub]);
    await ops.create(daily(10));
    await s.advanceTo(START + 30 * DAY);
    const stats = s.stats.get("cand-b-loop");
    expect(stats?.runs).toBe(1);
    expect(db.executions).toHaveLength(30);
    expect(stats?.steps).toBeGreaterThanOrEqual(4 * 30);
    costLog.push(
      `B-loop: 1 run, ${stats?.steps} steps after 30 daily occurrences ` +
        `(1,000-step cap reached after ~${Math.floor(1000 / ((stats?.steps ?? 1) / 30))} occurrences)`,
    );
  });

  it("D: a weekly task gets one reconcile twin per occurrence, which runs nothing extra", async () => {
    const { sim: s, ops } = setup("D");
    await ops.create({ ...daily(10), cadence: "weekly", weekday: 1 });
    await s.advanceTo(START + 28 * DAY);
    expect(db.executions).toHaveLength(4);
    const runs = s.stats.get("ai-workflow-scheduler")?.runs ?? 0;
    // 5 chained runs (the 5th sleeps toward 2026-12-07) + 1 twin per
    // occurrence, from the pass on its morning (the event was sent > 24 h ago).
    expect(runs).toBe(5 + 4);
    costLog.push(
      `D weekly task over 28 days: ${runs} scheduler runs for 4 occurrences`,
    );
  });
});

const costLog: string[] = [];

describe("cost per day (daily tasks, steady state)", () => {
  const rows: string[] = [];
  afterAll(() => {
    console.log(
      [
        "option | tasks | function runs/day | steps/day (excl. ai-workflow-run)",
        ...rows,
        ...costLog,
      ].join("\n"),
    );
  });

  describe.each(ALL)("option %s", (option) => {
    it.each([0, 10, 100])("%i tasks", async (n) => {
      const { sim: s, ops } = setup(option);
      for (let i = 0; i < n; i++) {
        const minutes = (10 * 60 + 15 * i) % (24 * 60);
        await ops.create(daily(Math.floor(minutes / 60), minutes % 60));
      }
      await s.advanceTo(START + DAY);
      const before = new Map(
        [...s.stats].map(([k, v]): [string, FnStats] => [k, { ...v }]),
      );
      const executionsBefore = db.executions.length;
      await s.advanceTo(START + 2 * DAY);
      let runs = 0;
      let steps = 0;
      for (const [fnId, v] of s.stats) {
        if (fnId === "ai-workflow-run") continue;
        runs += v.runs - (before.get(fnId)?.runs ?? 0);
        steps += v.steps - (before.get(fnId)?.steps ?? 0);
      }
      expect(db.executions.length - executionsBefore).toBe(n);
      rows.push(`${option} | ${n} | ${runs} | ${steps}`);
    });
  });
});
