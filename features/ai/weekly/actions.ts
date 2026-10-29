"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";

import { getLatestWeeklySummary, type WeeklySummary } from "./generate";

/** The caller's latest weekly CFO summary (ai:chat); null before the first. */
export async function getWeeklySummaryAction(): Promise<
  ActionResult<WeeklySummary | null>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "ai:chat")) {
    return { ok: false, error: "No tenés permiso para el resumen semanal." };
  }
  try {
    return { ok: true, data: await getLatestWeeklySummary(ctx.userId) };
  } catch (error) {
    logger.error("ai.weekly_summary.load_failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo cargar el resumen semanal." };
  }
}
