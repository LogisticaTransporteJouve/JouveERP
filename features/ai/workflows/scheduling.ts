import "server-only";

import { inngest } from "@/lib/inngest/client";
import {
  AI_WORKFLOW_CHANGED,
  AI_WORKFLOW_SCHEDULED,
  type AiWorkflowChanged,
  type AiWorkflowScheduled,
} from "@/lib/inngest/events";
import { logger } from "@/lib/logger";

/** The version a deleted task's change event carries: unlike any
 *  `updated_at`, so it cancels every scheduler of the task. */
export const DELETED_VERSION = "deleted";

/** Wakes ai-workflow-scheduler at the task's next occurrence. The id carries
 *  the version, so re-sending the same schedule (a retried action, a reconcile
 *  pass) within Inngest's 24-hour dedupe window starts nothing new. */
export function scheduledEvent(workflow: {
  id: string;
  nextRunAt: string;
  version: string;
}): {
  id: string;
  name: typeof AI_WORKFLOW_SCHEDULED;
  data: AiWorkflowScheduled;
} {
  return {
    id: `ai-workflow-scheduled-${workflow.id}-${workflow.version}`,
    name: AI_WORKFLOW_SCHEDULED,
    data: {
      workflow_id: workflow.id,
      next_run_at: workflow.nextRunAt,
      version: workflow.version,
    },
  };
}

export function changedEvent(
  workflowId: string,
  version: string,
): { id: string; name: typeof AI_WORKFLOW_CHANGED; data: AiWorkflowChanged } {
  return {
    id: `ai-workflow-changed-${workflowId}-${version}`,
    name: AI_WORKFLOW_CHANGED,
    data: { workflow_id: workflowId, version },
  };
}

/**
 * After a task's row changed: cancels its sleeping schedulers and, when it is
 * active, schedules its next occurrence. The write is already committed, so a
 * failed send is logged, not surfaced: the scheduler's stale guard ignores an
 * old schedule and the daily reconcile schedules the task again.
 */
export async function announceWorkflowChange(
  workflowId: string,
  state:
    | { active: true; nextRunAt: string; version: string }
    | { active: false; version: string },
): Promise<void> {
  const events = state.active
    ? [
        changedEvent(workflowId, state.version),
        scheduledEvent({ id: workflowId, ...state }),
      ]
    : [changedEvent(workflowId, state.version)];
  try {
    await inngest.send(events);
  } catch (error) {
    logger.error("ai.workflows.schedule_send_failed", { workflowId, error });
  }
}
