"use server";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan, type Access } from "@/lib/auth/permissions";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";
import { UuidSchema } from "@/lib/validation/common";

import { canSeeInsight } from "../insights/lib/visibility";
import {
  AI_PROPOSAL_TTL_MS,
  InsightProposalSchema,
  toProposalCard,
  type AiProposalCard,
  type AiProposalRow,
} from "../lib/ai-proposal-schema";
import {
  claimProposal,
  getProposal,
  insertProposal,
  latestProposalByKey,
  proposalDedupeKey,
  recordProposalOutcome,
} from "../lib/ai-proposals";
import { AI_ACTIONS } from "../registry/catalog";
import {
  canRunAiAction,
  type AiAction,
  type AiProposalOutcome,
} from "../registry/define";

// 6.3: proposals outside the chat. An insight offers one; the user prepares
// it with their own permissions (nothing is drafted in the background),
// reads the card and accepts or dismisses it. Accepting re-checks the
// action's permissions, re-validates the draft with the form's schema and
// claims the row (compare-and-set + guard_ai_proposal) before the write, so
// a double click executes once.

const isUuid = (value: string) => UuidSchema.safeParse(value).success;

const NO_AI = "No tenés permiso para ver insights de IA.";
const NO_ACTION = "No tenés permiso para esta acción.";
const GONE = "Esta propuesta ya no está pendiente.";
const EXPIRED =
  "La propuesta venció: generala de nuevo para ver los datos actuales.";

type Ctx = { userId: string; access: Access };

/** A thrown PostgREST error, for the guard mapper. */
function asDbError(
  error: unknown,
): { message: string; hint?: string | null } | null {
  if (typeof error !== "object" || error === null) return null;
  const message: unknown = Reflect.get(error, "message");
  const hint: unknown = Reflect.get(error, "hint");
  return typeof message === "string"
    ? { message, hint: typeof hint === "string" ? hint : null }
    : null;
}

/** The registry action behind a proposal, if it is still a proposal. */
function proposalAction(name: string): AiAction | undefined {
  return AI_ACTIONS.find((a) => a.name === name && a.proposal);
}

/**
 * Prepares the proposal an insight offers, for the caller: the insight must
 * be one they can see (RLS + the card's domain permission) and the action
 * one they can run. The same insight clicked again returns its pending
 * proposal, or the accepted one, instead of a second card.
 */
export async function prepareInsightProposalAction(
  insightId: string,
): Promise<ActionResult<AiProposalCard>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "ai:read")) return { ok: false, error: NO_AI };
  if (!isUuid(insightId)) {
    return { ok: false, error: "No se encontró el insight." };
  }

  const supabase = await createClient();
  const { data: insight, error } = await supabase
    .from("ai_insights")
    .select("id, kind, status, proposal")
    .eq("id", insightId)
    .maybeSingle();
  if (error) {
    logger.error("ai.proposals.insight_read_failed", {
      userId: ctx.userId,
      insightId,
      error,
    });
    return { ok: false, error: "No se pudo leer el insight." };
  }
  if (
    !insight ||
    insight.status === "dismissed" ||
    !canSeeInsight(ctx.access, insight.kind)
  ) {
    return { ok: false, error: "No se encontró el insight." };
  }
  const offered = InsightProposalSchema.safeParse(insight.proposal);
  if (!offered.success) {
    return { ok: false, error: "Este insight no tiene una propuesta." };
  }
  const action = proposalAction(offered.data.action);
  if (!action?.proposal) {
    return { ok: false, error: "Este insight no tiene una propuesta." };
  }
  if (!canRunAiAction(ctx.access, action)) {
    return { ok: false, error: NO_ACTION };
  }

  const dedupeKey = proposalDedupeKey(action.name, offered.data.input);
  try {
    const reused = await reusable(ctx, dedupeKey);
    if (reused) return { ok: true, data: toProposalCard(reused) };

    const prepared = await action.proposal.prepareDraft(
      ctx,
      offered.data.input,
    );
    if (prepared.kind === "error") return { ok: false, error: prepared.error };
    if (prepared.kind === "issues") {
      return {
        ok: false,
        error:
          `${prepared.issues[0]?.message ?? "Faltan datos."} ` +
          "Usá Resolver con IA para completarla.",
      };
    }
    const row = await insertProposal(ctx.userId, {
      action: action.name,
      insightId: insight.id,
      insightKind: insight.kind,
      dedupeKey,
      input: offered.data.input,
      draft: prepared.draft,
      labels: prepared.labels,
      summary: prepared.summary,
      title: action.proposal.spec.title,
      expiresAt: new Date(Date.now() + AI_PROPOSAL_TTL_MS).toISOString(),
    });
    // A concurrent prepare inserted it first: show that one.
    const card = row ?? (await latestProposalByKey(ctx.userId, dedupeKey));
    if (!card) return { ok: false, error: "No se pudo armar la propuesta." };
    return { ok: true, data: toProposalCard(card) };
  } catch (err) {
    logger.error("ai.proposals.prepare_failed", {
      userId: ctx.userId,
      insightId,
      action: action.name,
      error: err,
    });
    return { ok: false, error: "No se pudo armar la propuesta." };
  }
}

/** The caller's latest proposal with this key when it should be shown again
 *  instead of preparing a new one: still pending and in time, or accepted.
 *  A pending one past its time is closed as expired first. */
async function reusable(
  ctx: Ctx,
  dedupeKey: string,
): Promise<AiProposalRow | null> {
  const latest = await latestProposalByKey(ctx.userId, dedupeKey);
  if (!latest) return null;
  if (latest.status === "accepted") return latest;
  if (latest.status !== "pending") return null;
  if (Date.parse(latest.expires_at) > Date.now()) return latest;
  await claimProposal(ctx.userId, latest.id, "expired");
  return null;
}

/**
 * Accepts a pending proposal and performs its write. Order: `ai:read` and
 * the action's own permissions (the same the manual form checks), the draft
 * re-parsed with the form's schema, then the claim — only the request that
 * moves the row out of `pending` runs the write.
 */
export async function acceptAiProposalAction(
  id: string,
): Promise<ActionResult<{ resultId: string; note: string | null }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "ai:read")) return { ok: false, error: NO_AI };
  if (!isUuid(id)) return { ok: false, error: GONE };

  let row: AiProposalRow | null;
  try {
    row = await getProposal(ctx.userId, id);
  } catch (error) {
    logger.error("ai.proposals.read_failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo leer la propuesta." };
  }
  if (!row || row.status !== "pending") return { ok: false, error: GONE };
  const action = proposalAction(row.action);
  if (!action?.proposal) return { ok: false, error: GONE };
  if (!canRunAiAction(ctx.access, action)) {
    return { ok: false, error: NO_ACTION };
  }
  if (Date.parse(row.expires_at) <= Date.now()) {
    await expire(ctx, row.id);
    return { ok: false, error: EXPIRED };
  }
  const valid = action.proposal.spec.validate(row.draft, row.labels);
  if (!valid.ok) {
    return {
      ok: false,
      error: valid.issues[0]?.message ?? "La propuesta tiene datos inválidos.",
    };
  }

  let claimed: AiProposalRow | null;
  try {
    claimed = await claimProposal(ctx.userId, id, "accepted");
  } catch (error) {
    const guard = mapDbGuardError(asDbError(error), {
      slug: "ai.proposals.accept.rejected",
      userId: ctx.userId,
      id,
    });
    if (guard) return { ok: false, error: guard };
    logger.error("ai.proposals.claim_failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo aceptar la propuesta." };
  }
  if (!claimed) return { ok: false, error: GONE };

  let res: ActionResult<AiProposalOutcome>;
  try {
    res = await action.proposal.executeDraft(ctx, valid.draft);
  } catch (error) {
    logger.error("ai.proposal.execute_failed", {
      userId: ctx.userId,
      id,
      action: row.action,
      error,
    });
    res = { ok: false, error: "No se pudo completar la acción." };
  }
  await recordProposalOutcome(
    ctx.userId,
    id,
    res.ok ? { result: res.data } : { error: res.error },
  );
  await logAudit(
    res.ok ? "ai.proposal.accepted" : "ai.proposal.failed",
    ctx.userId,
    {
      action: row.action,
      source: row.source,
      insight_id: row.insight_id,
      insight_kind: row.insight_kind,
      result_id: res.ok ? res.data.id : null,
      ...(res.ok ? {} : { error: res.error }),
    },
    id,
  );
  if (!res.ok) return { ok: false, error: res.error };
  return {
    ok: true,
    data: { resultId: res.data.id, note: res.data.note ?? null },
  };
}

async function expire(ctx: Ctx, id: string): Promise<void> {
  try {
    await claimProposal(ctx.userId, id, "expired");
  } catch (error) {
    logger.error("ai.proposals.expire_failed", {
      userId: ctx.userId,
      id,
      error,
    });
  }
}

/** Dismisses a pending proposal (compare-and-set; nothing is written). */
export async function dismissAiProposalAction(
  id: string,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "ai:read")) return { ok: false, error: NO_AI };
  if (!isUuid(id)) return { ok: false, error: GONE };
  let claimed: AiProposalRow | null;
  try {
    claimed = await claimProposal(ctx.userId, id, "dismissed");
  } catch (error) {
    logger.error("ai.proposals.claim_failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo descartar la propuesta." };
  }
  if (!claimed) return { ok: false, error: GONE };
  await logAudit(
    "ai.proposal.dismissed",
    ctx.userId,
    {
      action: claimed.action,
      source: claimed.source,
      insight_id: claimed.insight_id,
      insight_kind: claimed.insight_kind,
    },
    id,
  );
  return { ok: true, data: undefined };
}
