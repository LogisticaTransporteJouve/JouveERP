import { beforeEach, describe, expect, it, vi } from "vitest";

const runs = {
  loadRun: vi.fn(),
  claimRun: vi.fn(async () => true),
  skipRun: vi.fn(async () => true),
  completeRun: vi.fn(async () => true),
  failRun: vi.fn(async () => true),
  materializeDueRuns: vi.fn(),
};
const resolveHeadlessUser = vi.fn();
const runAsHeadlessUser = vi.fn(
  async (_user: unknown, fn: () => Promise<unknown>) => fn(),
);
const checkAiDailyCap = vi.fn(async () => "ok");
const recordAiUsage = vi.fn(async () => undefined);
const runWorkflowAgent = vi.fn();
const loadRunMemory = vi.fn(async () => null);
const insert = vi.fn(async () => ({ error: null }));

vi.mock("@/features/ai/workflows/runs", () => runs);
vi.mock("@/lib/auth/headless-user", () => ({
  resolveHeadlessUser,
  runAsHeadlessUser,
}));
vi.mock("@/features/ai/lib/chat-store", () => ({
  checkAiDailyCap,
  recordAiUsage,
}));
vi.mock("@/features/ai/workflows/agent", () => ({ runWorkflowAgent }));
vi.mock("@/features/ai/workflows/memory-store", () => ({ loadRunMemory }));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ from: () => ({ insert }) }),
}));

const { aiWorkflowRun } = await import("./ai-workflow-run");
const { aiWorkflowsMaterialize } = await import("./ai-workflows-materialize");

const RUN = "3f0c9a9e-5a51-4c55-9b0e-0b7d1c1c2a10";
const USER = "8b5d3c7e-1f2a-4b3c-9d4e-5f6a7b8c9d0e";
const user = { userId: USER, email: "a@b.c", roles: ["finance"] };
const queuedRun = {
  runId: RUN,
  status: "queued",
  userId: USER,
  scheduledFor: "2026-10-19T11:00:00Z",
  previousRunId: null,
  workflow: { id: "w1", title: "Cobranzas", prompt: "p", isActive: true },
};

const step = {
  run: async (_id: string, fn: () => Promise<unknown>) => fn(),
  sendEvent: vi.fn(async () => undefined),
};

function invoke(fn: unknown, data: unknown) {
  const handler = Reflect.get(Object(fn), "fn");
  if (typeof handler !== "function") throw new Error("no handler");
  return handler({ event: { data }, step });
}

beforeEach(() => {
  vi.clearAllMocks();
  runs.loadRun.mockResolvedValue(queuedRun);
  resolveHeadlessUser.mockResolvedValue({ ok: true, user });
  checkAiDailyCap.mockResolvedValue("ok");
});

describe("ai-workflow-run config", () => {
  it("is idempotent on the run and runs one per user at a time", () => {
    const opts = Reflect.get(Object(aiWorkflowRun), "opts");
    expect(opts).toMatchObject({
      idempotency: "event.data.run_id",
      concurrency: [{ limit: 3 }, { key: "event.data.user_id", limit: 1 }],
    });
  });
});

describe("ai-workflow-run", () => {
  it("skips, with the reason, a user who lost ai:chat or was disabled", async () => {
    for (const reason of ["permission_revoked", "user_disabled"]) {
      resolveHeadlessUser.mockResolvedValueOnce({ ok: false, reason });
      const res = await invoke(aiWorkflowRun, { run_id: RUN, user_id: USER });
      expect(res).toMatchObject({ claimed: false, skipped: reason });
      expect(runs.skipRun).toHaveBeenLastCalledWith(
        RUN,
        reason,
        expect.any(Date),
      );
    }
    expect(runs.claimRun).not.toHaveBeenCalled();
    expect(runWorkflowAgent).not.toHaveBeenCalled();
  });

  it("skips when the daily AI cap is reached or cannot be checked", async () => {
    for (const cap of ["exceeded", "unavailable"]) {
      checkAiDailyCap.mockResolvedValueOnce(cap);
      const res = await invoke(aiWorkflowRun, { run_id: RUN, user_id: USER });
      expect(res).toMatchObject({ skipped: "daily_cap" });
    }
    expect(runWorkflowAgent).not.toHaveBeenCalled();
  });

  it("skips a paused task and ignores a run that is no longer queued", async () => {
    runs.loadRun.mockResolvedValueOnce({
      ...queuedRun,
      workflow: { ...queuedRun.workflow, isActive: false },
    });
    expect(
      await invoke(aiWorkflowRun, { run_id: RUN, user_id: USER }),
    ).toMatchObject({ skipped: "workflow_paused" });
    runs.loadRun.mockResolvedValueOnce({ ...queuedRun, status: "succeeded" });
    expect(await invoke(aiWorkflowRun, { run_id: RUN, user_id: USER })).toEqual(
      { claimed: false },
    );
    expect(runWorkflowAgent).not.toHaveBeenCalled();
  });

  it("runs the agent as the run's owner (from the row, not the event), stores the answer and notifies", async () => {
    runs.loadRun
      .mockResolvedValueOnce(queuedRun)
      .mockResolvedValueOnce({ ...queuedRun, status: "running" });
    runWorkflowAgent.mockResolvedValue({
      output: "o",
      summary: "s",
      toolNames: ["getClientAging"],
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      model: "m",
    });
    const res = await invoke(aiWorkflowRun, {
      run_id: RUN,
      user_id: "00000000-0000-4000-8000-000000000000",
    });
    expect(res).toEqual({ claimed: true, completed: true });
    expect(resolveHeadlessUser).toHaveBeenCalledWith(
      USER,
      "ai:chat",
      expect.any(Date),
    );
    expect(runAsHeadlessUser.mock.calls[0]?.[0]).toBe(user);
    expect(runWorkflowAgent).toHaveBeenCalledWith(
      expect.objectContaining({ runId: RUN, runDate: "2026-10-19" }),
    );
    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "workflow_run", userId: USER }),
    );
    expect(runs.completeRun).toHaveBeenCalledWith(
      RUN,
      expect.objectContaining({ output: "o", summary: "s" }),
      expect.any(Date),
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient_id: USER,
        type: "ai_workflow_run",
      }),
    );
  });

  it("skips the run without calling the model when the user lost access between steps", async () => {
    runs.loadRun
      .mockResolvedValueOnce(queuedRun)
      .mockResolvedValueOnce({ ...queuedRun, status: "running" });
    resolveHeadlessUser
      .mockResolvedValueOnce({ ok: true, user })
      .mockResolvedValueOnce({ ok: false, reason: "permission_revoked" });
    const res = await invoke(aiWorkflowRun, { run_id: RUN, user_id: USER });
    expect(res).toEqual({ claimed: true, completed: false });
    expect(runs.skipRun).toHaveBeenCalledWith(
      RUN,
      "permission_revoked",
      expect.any(Date),
    );
    expect(runWorkflowAgent).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("ai-workflows-materialize", () => {
  it("fans out one event per queued run with the run id as event id", async () => {
    runs.materializeDueRuns.mockResolvedValue([{ runId: RUN, userId: USER }]);
    await invoke(aiWorkflowsMaterialize, {});
    expect(step.sendEvent).toHaveBeenCalledWith("fan-out-runs", [
      {
        id: `ai-workflow-run-${RUN}`,
        name: "ai/workflow-run.requested",
        data: { run_id: RUN, user_id: USER },
      },
    ]);
  });

  it("sends nothing when nothing is due", async () => {
    runs.materializeDueRuns.mockResolvedValue([]);
    await invoke(aiWorkflowsMaterialize, {});
    expect(step.sendEvent).not.toHaveBeenCalled();
  });
});
