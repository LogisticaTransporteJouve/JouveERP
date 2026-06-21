import { regenerateInsights } from "@/features/ai/insights/analyst";
import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";

/**
 * Proactive-insights analyst (docs/ai-overview.md §5). Weekly cron that
 * recomputes the cash-flow projection + receivables risk and replaces the open
 * insight rows. Deterministic compute (no LLM) — the projection math lives in
 * features/ai/insights.
 */
export const aiAnalyst = inngest.createFunction(
  {
    id: "ai-analyst",
    name: "AI — insights proactivos",
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires 0 7 * * 1" }],
    retries: 2,
  },
  async ({ step }) => {
    const result = await step.run("regenerate", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const count = await regenerateInsights(today);
      return { count, today };
    });
    logger.info("ai.analyst.ran", result);
    return result;
  },
);
