import { materializeDueRuns } from "@/features/ai/workflows/runs";
import { inngest } from "@/lib/inngest/client";
import { AI_WORKFLOW_RUN_REQUESTED } from "@/lib/inngest/events";
import { logger } from "@/lib/logger";

/**
 * Every 15 minutes (the grid task times sit on): queues one run per due AI
 * task, advances each task to its next occurrence and fans out one event per
 * queued run. The event id is the run id, so a retried step or the next pass
 * re-sending a still-queued run never starts it twice (ai-workflow-run is
 * also idempotent on run_id).
 */
export const aiWorkflowsMaterialize = inngest.createFunction(
  {
    id: "ai-workflows-materialize",
    name: "AI — materializar tareas programadas",
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires */15 * * * *" }],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    const queued = await step.run("materialize", () =>
      materializeDueRuns(new Date()),
    );
    if (queued.length > 0) {
      await step.sendEvent(
        "fan-out-runs",
        queued.map((run) => ({
          id: `ai-workflow-run-${run.runId}`,
          name: AI_WORKFLOW_RUN_REQUESTED,
          data: { run_id: run.runId, user_id: run.userId },
        })),
      );
    }
    logger.info("ai.workflows.materialized", { queued: queued.length });
    return { queued: queued.length };
  },
);
