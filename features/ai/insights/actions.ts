"use server";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan, type Access } from "@/lib/auth/permissions";
import type { Json } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayInAR } from "@/lib/format";

import { InsightProposalSchema } from "../lib/ai-proposal-schema";
import { AI_ACTIONS } from "../registry/catalog";
import { canRunAiAction } from "../registry/define";
import { regenerateInsights } from "./analyst";
import { IgnoreInsightSchema } from "./lib/ignore-schema";
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
  /** The proposal the card offers, only when the user may run its action. */
  proposal: { action: string; label: string } | null;
};

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const SELECT_COLUMNS =
  "id, kind, severity, title, finding, metrics, source_refs, period, status, generated_at, proposal";

/** The card's proposal button, when the analyst attached one and `access`
 *  may run its registry action (the accept re-checks the same). */
function offeredProposal(
  access: Access,
  raw: unknown,
): InsightCard["proposal"] {
  const parsed = InsightProposalSchema.safeParse(raw);
  if (!parsed.success) return null;
  const action = AI_ACTIONS.find(
    (a) => a.name === parsed.data.action && a.proposal,
  );
  if (!action || !canRunAiAction(access, action)) return null;
  return { action: action.name, label: parsed.data.label };
}

/** How many cards the panel shows; the rest are counted in `total`. */
const INSIGHTS_SHOWN = 50;

export type InsightList = {
  /** The first `INSIGHTS_SHOWN` visible cards, severity first. */
  items: InsightCard[];
  /** Every visible live card, so the panel can say "mostrando N de M". */
  total: number;
};

/** Open + acknowledged insights for the dashboard (ai:read), severity first.
 *  The live set is bounded by the analyst's last run, so it is drained and
 *  filtered before the cap: a cut in SQL would drop critical cards or every
 *  card of the user's domains (one run shares one `generated_at`). */
export async function listInsightsAction(): Promise<ActionResult<InsightList>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "ai:read")) {
    return { ok: false, error: "No tenés permiso para ver insights." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await paginateRange((from, to) =>
    supabase
      .from("ai_insights")
      .select(SELECT_COLUMNS)
      .neq("status", "dismissed")
      .order("id")
      .range(from, to),
  );
  if (error) {
    logger.error("ai.insights.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron cargar los insights." };
  }

  // Defense in depth on top of RLS: drop cards from domains this user can't
  // read (e.g. operations must not see treasury / AR / AP cards).
  const visible = data
    .filter((card) => canSeeInsight(ctx.access, card.kind))
    .map(({ proposal, ...card }) => ({
      ...card,
      proposal: offeredProposal(ctx.access, proposal),
    }));
  const cards = visible.sort((a, b) => {
    const sev =
      (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
    if (sev !== 0) return sev;
    const age = b.generated_at.localeCompare(a.generated_at);
    return age !== 0 ? age : a.id.localeCompare(b.id);
  });
  return {
    ok: true,
    data: { items: cards.slice(0, INSIGHTS_SHOWN), total: cards.length },
  };
}

/** On-demand recompute of the analyst's insights (ai:admin). */
export async function runAnalystAction(): Promise<
  ActionResult<{ count: number }>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "ai:admin")) {
    return { ok: false, error: "No tenés permiso para recalcular insights." };
  }
  try {
    const today = todayInAR();
    const count = await regenerateInsights(today);
    await logAudit("ai.insights.regenerated", ctx.userId, { count });
    return { ok: true, data: { count } };
  } catch (err) {
    logger.error("ai.insights.run.failed", { userId: ctx.userId, error: err });
    return { ok: false, error: "No se pudieron recalcular los insights." };
  }
}

/** Acknowledge an insight card (ai:admin; RLS update gated too). Ignoring
 *  one goes through `ignoreInsightAction`, which records the reason. */
export async function setInsightStatusAction(input: {
  id: string;
  status: "acknowledged";
}): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "ai:admin")) {
    return { ok: false, error: "No tenés permiso para gestionar insights." };
  }
  if (input.status !== "acknowledged") {
    return { ok: false, error: "Estado inválido." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("ai_insights")
    .update({ status: input.status })
    .eq("id", input.id)
    .select("id");
  if (error) {
    logger.error("ai.insights.set_status.failed", {
      userId: ctx.userId,
      id: input.id,
      error,
    });
    return { ok: false, error: "No se pudo actualizar el insight." };
  }
  // A recalculation replaces the cards with new ids: the one on screen is gone.
  if (!data?.[0]) {
    return {
      ok: false,
      error: "Esta tarjeta se recalculó. Recargá los insights.",
    };
  }
  await logAudit(`ai.insight.${input.status}`, ctx.userId, {}, input.id);
  return { ok: true, data: undefined };
}

/**
 * Ignores a finding with the reason (ai:admin; the RLS update policy gates
 * the same roles). The analyst skips findings with the same fingerprint on
 * later runs.
 */
export async function ignoreInsightAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "ai:admin")) {
    return { ok: false, error: "No tenés permiso para gestionar insights." };
  }
  const parsed = IgnoreInsightSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("ai_insights")
    .update({
      status: "dismissed",
      dismissed_reason: parsed.data.reason,
      dismissed_by: ctx.userId,
      dismissed_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.id)
    .select("id, kind");
  if (error) {
    logger.error("ai.insights.ignore.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error,
    });
    return { ok: false, error: "No se pudo ignorar el insight." };
  }
  const row = data?.[0];
  if (!row) return { ok: false, error: "No se encontró el insight." };
  await logAudit(
    "ai.insight.ignored",
    ctx.userId,
    { kind: row.kind, reason: parsed.data.reason },
    row.id,
  );
  return { ok: true, data: undefined };
}
