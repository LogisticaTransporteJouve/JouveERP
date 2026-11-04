import {
  expireAndListQueuedRuns,
  listWorkflowsToSchedule,
} from "@/features/ai/workflows/runs";
import { arDate } from "@/features/ai/workflows/schedule";
import { scheduledEvent } from "@/features/ai/workflows/scheduling";
import { inngest } from "@/lib/inngest/client";
import { AI_WORKFLOW_RUN_REQUESTED } from "@/lib/inngest/events";
import { logger } from "@/lib/logger";

/** How far ahead a pass schedules: past the next daily pass, so every
 *  occurrence falls inside some pass's window. */
export const RECONCILE_HORIZON_MS = 26 * 60 * 60 * 1000;

/**
 * The schedule event for one task. A task still ahead keeps the id its
 * scheduler was started with, deduped when that was under 24 hours ago. An
 * overdue task's scheduler is gone or failed, yet its event may be under 24
 * hours old (sent when the version was written), so it gets an id of its own
 * for this pass.
 */
export function reconcileEvent(
  workflow: { id: string; nextRunAt: string; version: string },
  passAt: number,
) {
  const event = scheduledEvent(workflow);
  return Date.parse(workflow.nextRunAt) <= passAt
    ? { ...event, id: `${event.id}-reconcile-${arDate(new Date(passAt))}` }
    : event;
}

/**
 * Daily safety net for the event-driven AI task schedule (each task's
 * ai-workflow-scheduler sleeps until its own `next_run_at`):
 *   1. re-sends runs still queued (lost ai/workflow-run.requested) and closes
 *      the ones past the re-send window;
 *   2. schedules again every active task due before the next pass, overdue
 *      ones included: a lost or failed scheduler, a send that failed after
 *      the action's write, or a task that predates the scheduler.
 * Run events dedupe on the run id, and a twin scheduler of one task loses the
 * compare-and-set on `next_run_at`, so a pass never runs an occurrence twice.
 */
export const aiWorkflowsReconcile = inngest.createFunction(
  {
    id: "ai-workflows-reconcile",
    name: "AI — reconciliar tareas programadas",
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires 52 4 * * *" }],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    const queued = await step.run("expire-and-list-queued", () =>
      expireAndListQueuedRuns(new Date()),
    );
    if (queued.length > 0) {
      await step.sendEvent(
        "resend-runs",
        queued.map((run) => ({
          id: `ai-workflow-run-${run.runId}`,
          name: AI_WORKFLOW_RUN_REQUESTED,
          data: { run_id: run.runId, user_id: run.userId },
        })),
      );
    }

    const { due, passAt } = await step.run("list-to-schedule", async () => {
      const now = Date.now();
      return {
        due: await listWorkflowsToSchedule(
          new Date(now + RECONCILE_HORIZON_MS),
        ),
        passAt: now,
      };
    });
    if (due.length > 0) {
      await step.sendEvent(
        "schedule",
        due.map((workflow) => reconcileEvent(workflow, passAt)),
      );
    }

    logger.info("ai.workflows.reconciled", {
      resent: queued.length,
      scheduled: due.length,
    });
    return { resent: queued.length, scheduled: due.length };
  },
);
