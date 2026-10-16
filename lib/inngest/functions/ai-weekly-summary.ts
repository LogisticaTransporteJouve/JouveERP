import { checkAiDailyCap, recordAiUsage } from "@/features/ai/lib/chat-store";
import {
  generateWeeklySummary,
  listWeeklySummaryRecipients,
  saveWeeklySummary,
} from "@/features/ai/weekly/generate";
import { arWeekStart } from "@/features/ai/workflows/schedule";
import {
  resolveHeadlessUser,
  runAsHeadlessUser,
} from "@/lib/auth/headless-user";
import { ROLES, userCan } from "@/lib/auth/permissions";
import { inngest } from "@/lib/inngest/client";
import {
  AI_WEEKLY_SUMMARY_REQUESTED,
  AiWeeklySummaryRequestedSchema,
} from "@/lib/inngest/events";
import { logger } from "@/lib/logger";

const AI_CHAT_ROLES = ROLES.filter((role) => userCan([role], "ai:chat"));

/**
 * Monday 07:50 Buenos Aires: one weekly-summary event per active user who
 * holds ai:chat. The event id is (user, week), so a retried fan-out never
 * writes a second summary.
 */
export const aiWeeklySummaryFanOut = inngest.createFunction(
  {
    id: "ai-weekly-summary-fan-out",
    name: "AI — resumen semanal (fan-out)",
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires 50 7 * * 1" }],
    retries: 2,
  },
  async ({ step }) => {
    const { weekStart, userIds } = await step.run("recipients", async () => {
      const now = new Date();
      return {
        weekStart: arWeekStart(now),
        userIds: await listWeeklySummaryRecipients(AI_CHAT_ROLES, now),
      };
    });
    if (userIds.length > 0) {
      await step.sendEvent(
        "fan-out",
        userIds.map((userId) => ({
          id: `ai-weekly-summary-${userId}-${weekStart}`,
          name: AI_WEEKLY_SUMMARY_REQUESTED,
          data: { user_id: userId, week_start: weekStart },
        })),
      );
    }
    return { weekStart, users: userIds.length };
  },
);

/**
 * The weekly summary for one user, as that user (their read permissions and
 * RLS), within the daily AI cap. Skips quietly when the user is no longer
 * eligible or the cap is reached.
 */
export const aiWeeklySummary = inngest.createFunction(
  {
    id: "ai-weekly-summary",
    name: "AI — resumen semanal por usuario",
    triggers: [{ event: AI_WEEKLY_SUMMARY_REQUESTED }],
    idempotency: "event.data.user_id + '-' + event.data.week_start",
    concurrency: { limit: 2 },
    retries: 1,
  },
  async ({ event, step }) => {
    const { user_id: userId, week_start: weekStart } =
      AiWeeklySummaryRequestedSchema.parse(event.data);

    return step.run("generate", async () => {
      const now = new Date();
      const eligibility = await resolveHeadlessUser(userId, "ai:chat", now);
      if (!eligibility.ok) {
        logger.info("ai.weekly_summary.skipped", {
          userId,
          reason: eligibility.reason,
        });
        return { skipped: eligibility.reason };
      }
      if ((await checkAiDailyCap()) !== "ok") {
        logger.warn("ai.weekly_summary.skipped", {
          userId,
          reason: "daily_cap",
        });
        return { skipped: "daily_cap" };
      }
      const user = eligibility.user;
      const draft = await runAsHeadlessUser(user, () =>
        generateWeeklySummary(user, weekStart, now),
      );
      if (!draft) return { skipped: "no_data" };
      await recordAiUsage({
        kind: "weekly_summary",
        userId,
        model: draft.model,
        ...draft.usage,
      });
      await saveWeeklySummary(userId, weekStart, draft);
      return { saved: true };
    });
  },
);
