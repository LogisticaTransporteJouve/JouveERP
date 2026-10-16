import { checkAiDailyCap, recordAiUsage } from "@/features/ai/lib/chat-store";
import {
  allReadsFailed,
  runWorkflowAgent,
  type WorkflowAgentResult,
} from "@/features/ai/workflows/agent";
import { loadRunMemory } from "@/features/ai/workflows/memory-store";
import {
  claimRun,
  completeRun,
  failRun,
  loadRun,
  skipRun,
} from "@/features/ai/workflows/runs";
import { arDate } from "@/features/ai/workflows/schedule";
import {
  HeadlessTokenRejectedError,
  resolveHeadlessUser,
  runAsHeadlessUser,
} from "@/lib/auth/headless-user";
import { inngest } from "@/lib/inngest/client";
import {
  AI_WORKFLOW_RUN_REQUESTED,
  AiWorkflowRunRequestedSchema,
  failedEventData,
} from "@/lib/inngest/events";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

const NOTIFICATION_PREVIEW_CHARS = 200;

const ALL_READS_FAILED = "Ninguna consulta devolvió datos.";

/**
 * Runs one occurrence of a user's AI task as that user:
 *   claim   → re-reads the run, the task, the user's account and roles and
 *             the daily AI cap; skips (with the reason) or moves the run
 *             queued → running.
 *   execute → re-checks the user, then runs the agent with their read-only
 *             tools inside `runAsHeadlessUser` (their token, so every read
 *             action keeps its userCan gate and RLS), and stores the answer
 *             and its summary (the next run's memory).
 *   notify  → in-app notification to the owner.
 * Concurrency: 3 runs at once, 1 per user. Idempotent on run_id; every status
 * change is a compare-and-set.
 */
export const aiWorkflowRun = inngest.createFunction(
  {
    id: "ai-workflow-run",
    name: "AI — correr tarea programada",
    triggers: [{ event: AI_WORKFLOW_RUN_REQUESTED }],
    idempotency: "event.data.run_id",
    concurrency: [{ limit: 3 }, { key: "event.data.user_id", limit: 1 }],
    retries: 1,
    onFailure: async ({ event, error }) => {
      const parsed = AiWorkflowRunRequestedSchema.safeParse(
        failedEventData(event.data),
      );
      if (!parsed.success) {
        logger.warn("ai.workflow_run.failed_unparseable_event", {
          err: error.message,
        });
        return;
      }
      logger.warn("ai.workflow_run.failed", {
        runId: parsed.data.run_id,
        err: error.message,
      });
      await failRun(parsed.data.run_id, "La corrida falló.", new Date());
    },
  },
  async ({ event, step }) => {
    const { run_id: runId } = AiWorkflowRunRequestedSchema.parse(event.data);

    const claim = await step.run("claim", async () => {
      const now = new Date();
      const run = await loadRun(runId);
      if (!run || run.status !== "queued") return { claimed: false };
      if (!run.workflow.isActive) {
        await skipRun(runId, "workflow_paused", now);
        return { claimed: false, skipped: "workflow_paused" };
      }
      const eligibility = await resolveHeadlessUser(run.userId, "ai:chat", now);
      if (!eligibility.ok) {
        await skipRun(runId, eligibility.reason, now);
        return { claimed: false, skipped: eligibility.reason };
      }
      if ((await checkAiDailyCap({ background: true })) !== "ok") {
        await skipRun(runId, "daily_cap", now);
        return { claimed: false, skipped: "daily_cap" };
      }
      return { claimed: await claimRun(runId, now) };
    });
    if (!claim.claimed) return claim;

    const result = await step.run("execute", async () => {
      const run = await loadRun(runId);
      if (!run || run.status !== "running") return null;
      // Roles are read again here: a retry can come minutes later.
      const eligibility = await resolveHeadlessUser(run.userId, "ai:chat");
      if (!eligibility.ok) {
        await skipRun(runId, eligibility.reason, new Date());
        return null;
      }
      const user = eligibility.user;
      const memory = await loadRunMemory(
        user.userId,
        run.workflow.id,
        run.previousRunId,
      );
      let answer: WorkflowAgentResult;
      try {
        answer = await runAsHeadlessUser(user, () =>
          runWorkflowAgent({
            user,
            runId,
            workflow: run.workflow,
            runDate: arDate(new Date(run.scheduledFor)),
            memory,
          }),
        );
      } catch (error) {
        if (error instanceof HeadlessTokenRejectedError) {
          await skipRun(runId, "headless_unavailable", new Date());
          return null;
        }
        throw error;
      }
      // Usage is recorded only by the attempt whose compare-and-set saved
      // the outcome (recordAiUsage never throws, so nothing after it retries
      // the step): a retried step does not count twice.
      const record = () =>
        recordAiUsage({
          kind: "workflow_run",
          userId: user.userId,
          model: answer.model,
          toolNames: answer.toolNames,
          ...answer.usage,
        });
      if (allReadsFailed(answer.reads)) {
        if (await failRun(runId, ALL_READS_FAILED, new Date())) await record();
        return null;
      }
      if (!(await completeRun(runId, answer, new Date()))) return null;
      await record();
      // Ids and the task's own title only: figures stay in the database, out
      // of Inngest's step state and of the notification.
      return {
        userId: user.userId,
        workflowId: run.workflow.id,
        title: run.workflow.title,
      };
    });
    if (!result) return { claimed: true, completed: false };

    await step.run("notify", async () => {
      const { error } = await getServiceClient()
        .from("notifications")
        .insert({
          recipient_id: result.userId,
          sender_id: null,
          type: "ai_workflow_run",
          metadata: {
            run_id: runId,
            workflow_id: result.workflowId,
            preview: `${result.title}: resultado listo.`.slice(
              0,
              NOTIFICATION_PREVIEW_CHARS,
            ),
          },
        });
      if (error) throw new Error(`notify: ${error.message}`);
    });

    logger.info("ai.workflow_run.done", { runId });
    return { claimed: true, completed: true };
  },
);
