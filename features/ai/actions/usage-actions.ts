"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";

import { AI_DAILY_TOKEN_CAP, getAiUsageToday } from "../lib/chat-store";

export type AiUsageTodaySummary = {
  totalTokens: number;
  costUsd: number;
  cap: number;
};

/** Today's global AI token usage + the daily cap, for the meter (ai:read). */
export async function getAiUsageTodayAction(): Promise<
  ActionResult<AiUsageTodaySummary>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:read")) {
    return { ok: false, error: "No tenés permiso para ver el consumo de IA." };
  }

  // The meter is non-critical: if the aggregate RPC errors, report zero rather
  // than failing the page (the server-side cap still enforces fail-closed).
  try {
    const usage = await getAiUsageToday();
    return { ok: true, data: { ...usage, cap: AI_DAILY_TOKEN_CAP } };
  } catch (err) {
    logger.error("ai.usage.today.action_failed", { userId: ctx.userId, error: err });
    return {
      ok: true,
      data: { totalTokens: 0, costUsd: 0, cap: AI_DAILY_TOKEN_CAP },
    };
  }
}
