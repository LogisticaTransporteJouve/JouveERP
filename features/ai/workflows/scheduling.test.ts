import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn(async (_events: unknown) => ({ ids: [] }));
const error = vi.fn();
vi.mock("@/lib/inngest/client", () => ({ inngest: { send } }));
vi.mock("@/lib/logger", () => ({ logger: { error } }));

const { announceWorkflowChange, changedEvent, scheduledEvent } =
  await import("./scheduling");

const WF = "3f0c9a9e-5a51-4c55-9b0e-0b7d1c1c2a10";
const NEXT = "2026-11-09T11:00:00+00:00";

beforeEach(() => {
  send.mockClear();
  error.mockClear();
});

describe("announceWorkflowChange", () => {
  it("cancels the old schedule and schedules the active task, ids carrying the version", async () => {
    await announceWorkflowChange(WF, {
      active: true,
      nextRunAt: NEXT,
      version: "v2",
    });
    expect(send).toHaveBeenCalledWith([
      {
        id: `ai-workflow-changed-${WF}-v2`,
        name: "ai/workflow.changed",
        data: { workflow_id: WF, version: "v2" },
      },
      {
        id: `ai-workflow-scheduled-${WF}-v2`,
        name: "ai/workflow.scheduled",
        data: { workflow_id: WF, next_run_at: NEXT, version: "v2" },
      },
    ]);
  });

  it("only cancels a paused or deleted task", async () => {
    await announceWorkflowChange(WF, { active: false, version: "deleted" });
    expect(send).toHaveBeenCalledWith([changedEvent(WF, "deleted")]);
  });

  it("logs, and does not throw, when the send fails after the write", async () => {
    send.mockRejectedValueOnce(new Error("inngest down"));
    await expect(
      announceWorkflowChange(WF, { active: false, version: "v3" }),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      "ai.workflows.schedule_send_failed",
      expect.objectContaining({ workflowId: WF }),
    );
  });

  it("gives the same id to the same schedule, so a retried action dedupes", () => {
    const w = { id: WF, nextRunAt: NEXT, version: "v2" };
    expect(scheduledEvent(w).id).toBe(scheduledEvent({ ...w }).id);
    expect(scheduledEvent({ ...w, version: "v3" }).id).not.toBe(
      scheduledEvent(w).id,
    );
  });
});
