"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { fetchLatestUsdRate } from "@/lib/fx";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

import { AI_DAILY_COST_CAP_USD, getAiUsageToday } from "../lib/chat-store";
import type { AiSpendToday } from "../lib/usage-money";

/** Today's global AI spend + the daily cap (USD) and the official dollar the
 *  meter shows them at (ai:read). */
export async function getAiUsageTodayAction(): Promise<
  ActionResult<AiSpendToday>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "ai:read")) {
    return { ok: false, error: "No tenés permiso para ver el consumo de IA." };
  }

  const usdRate = await fetchLatestUsdRate(getServiceClient());
  // The meter is non-critical: if the aggregate RPC errors, report zero rather
  // than failing the page (the server-side cap still enforces fail-closed).
  try {
    const usage = await getAiUsageToday();
    return {
      ok: true,
      data: { costUsd: usage.costUsd, capUsd: AI_DAILY_COST_CAP_USD, usdRate },
    };
  } catch (err) {
    logger.error("ai.usage.today.action_failed", {
      userId: ctx.userId,
      error: err,
    });
    return {
      ok: true,
      data: { costUsd: 0, capUsd: AI_DAILY_COST_CAP_USD, usdRate },
    };
  }
}
