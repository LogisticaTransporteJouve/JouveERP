import {
  loadScheduledWorkflow,
  queueOccurrence,
  staleReason,
} from "@/features/ai/workflows/runs";
import { scheduledEvent } from "@/features/ai/workflows/scheduling";
import { inngest } from "@/lib/inngest/client";
import {
  AI_WORKFLOW_CHANGED,
  AI_WORKFLOW_RUN_REQUESTED,
  AI_WORKFLOW_SCHEDULED,
  AiWorkflowScheduledSchema,
} from "@/lib/inngest/events";
import { logger } from "@/lib/logger";

/** Longest single sleep, under the 7-day cap assumed for Inngest's Hobby plan
 *  (unverified, see docs/decisions.md 2026-11-04); a monthly task sleeps in
 *  hops. */
export const MAX_SLEEP_MS = 6 * 24 * 60 * 60 * 1000;

/** The instants to sleep until, each at most MAX_SLEEP_MS after the last,
 *  ending at `target`. Derived from the event's own timestamp so every replay
 *  of the run walks the same step ids. */
export function sleepHops(fromMs: number, target: Date): Date[] {
  const hops: Date[] = [];
  for (
    let at = fromMs + MAX_SLEEP_MS;
    at < target.getTime();
    at += MAX_SLEEP_MS
  ) {
    hops.push(new Date(at));
  }
  hops.push(target);
  return hops;
}

/**
 * One occurrence of one AI task: sleeps until the task's `next_run_at`, queues
 * its run (ai-workflow-run, event id = run id) and schedules the next
 * occurrence by sending itself a new event. One run per occurrence keeps each
 * run at a handful of steps (a loop in one run would grow by ~5 steps per
 * occurrence toward Inngest's 1,000-step cap and replay its whole history).
 *
 * A change to the task (ai/workflow.changed with another version) cancels the
 * sleeping run; on waking, the run re-reads the task and exits when it was
 * deleted, paused or rescheduled, in case the cancel was lost. The daily
 * ai-workflows-reconcile schedules again any task whose chain broke.
 */
export const aiWorkflowScheduler = inngest.createFunction(
  {
    id: "ai-workflow-scheduler",
    name: "AI — programar tarea",
    triggers: [{ event: AI_WORKFLOW_SCHEDULED }],
    // Inngest ignores `if` when `match` is set, so the workflow match is
    // spelled out. The version clause keeps the change event that precedes
    // a new schedule from cancelling that new schedule's own run.
    cancelOn: [
      {
        event: AI_WORKFLOW_CHANGED,
        if: "async.data.workflow_id == event.data.workflow_id && async.data.version != event.data.version",
      },
    ],
    retries: 3,
  },
  async ({ event, step }) => {
    const data = AiWorkflowScheduledSchema.parse(event.data);
    const expected = { nextRunAt: data.next_run_at, version: data.version };

    const hops = sleepHops(event.ts ?? Date.now(), new Date(data.next_run_at));
    for (const [i, wakeAt] of hops.entries()) {
      await step.sleepUntil(`sleep-${i}`, wakeAt);
    }

    const check = await step.run("check", async () => {
      const workflow = await loadScheduledWorkflow(data.workflow_id);
      const stale = staleReason(workflow, expected);
      return stale || !workflow ? { stale: stale ?? "deleted" } : { workflow };
    });
    if (!("workflow" in check)) {
      logger.info("ai.workflow_scheduler.stale", {
        workflowId: data.workflow_id,
        reason: check.stale,
      });
      return { queued: false, stale: check.stale };
    }

    const occurrence = await step.run("queue", () =>
      queueOccurrence(check.workflow, new Date()),
    );
    if (occurrence.run) {
      const { runId, userId } = occurrence.run;
      await step.sendEvent("request-run", {
        id: `ai-workflow-run-${runId}`,
        name: AI_WORKFLOW_RUN_REQUESTED,
        data: { run_id: runId, user_id: userId },
      });
    }
    if (occurrence.next) {
      await step.sendEvent(
        "schedule-next",
        scheduledEvent({ id: data.workflow_id, ...occurrence.next }),
      );
    }
    return {
      queued: occurrence.run !== null,
      nextRunAt: occurrence.next?.nextRunAt ?? null,
    };
  },
);
