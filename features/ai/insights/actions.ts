"use server";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Json } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { regenerateInsights } from "./analyst";
import { canSeeInsight } from "./lib/visibility";

export type InsightCard = {
  id: string;
  kind: string;
  severity: string;
  title: string;
  finding: string;
  metrics: Json;
  source_refs: Json;
  period: string | null;
  status: string;
  generated_at: string;
};

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const SELECT_COLUMNS =
  "id, kind, severity, title, finding, metrics, source_refs, period, status, generated_at";

/** Open + acknowledged insights for the dashboard (ai:read), severity first. */
export async function listInsightsAction(): Promise<
  ActionResult<InsightCard[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:read")) {
    return { ok: false, error: "No tenés permiso para ver insights." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("ai_insights")
    .select(SELECT_COLUMNS)
    .neq("status", "dismissed")
    .order("generated_at", { ascending: false })
    .limit(50);
  if (error) {
    logger.error("ai.insights.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron cargar los insights." };
  }

  // Defense in depth on top of RLS: drop cards from domains this user can't
  // read (e.g. operations must not see treasury / AR / AP cards).
  const visible = (data ?? []).filter((card) =>
    canSeeInsight(ctx.roles, card.kind),
  );
  const cards = visible.sort((a, b) => {
    const sev = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
    return sev !== 0 ? sev : b.generated_at.localeCompare(a.generated_at);
  });
  return { ok: true, data: cards };
}

/** On-demand recompute of the analyst's insights (ai:admin). */
export async function runAnalystAction(): Promise<ActionResult<{ count: number }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:admin")) {
    return { ok: false, error: "No tenés permiso para recalcular insights." };
  }
  try {
    const today = new Date().toISOString().slice(0, 10);
    const count = await regenerateInsights(today);
    await logAudit("ai.insights.regenerated", ctx.userId, { count });
    return { ok: true, data: { count } };
  } catch (err) {
    logger.error("ai.insights.run.failed", { userId: ctx.userId, error: err });
    return { ok: false, error: "No se pudieron recalcular los insights." };
  }
}

/** Acknowledge or dismiss an insight card (ai:admin; RLS update gated too). */
export async function setInsightStatusAction(input: {
  id: string;
  status: "acknowledged" | "dismissed";
}): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:admin")) {
    return { ok: false, error: "No tenés permiso para gestionar insights." };
  }
  if (input.status !== "acknowledged" && input.status !== "dismissed") {
    return { ok: false, error: "Estado inválido." };
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("ai_insights")
    .update({ status: input.status })
    .eq("id", input.id);
  if (error) {
    logger.error("ai.insights.set_status.failed", {
      userId: ctx.userId,
      id: input.id,
      error,
    });
    return { ok: false, error: "No se pudo actualizar el insight." };
  }
  await logAudit(`ai.insight.${input.status}`, ctx.userId, {}, input.id);
  return { ok: true, data: undefined };
}
