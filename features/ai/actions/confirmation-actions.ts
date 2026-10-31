"use server";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { UuidSchema } from "@/lib/validation/common";

import type { AiConfirmation } from "../lib/confirmation-schema";
import {
  claimConfirmation,
  createConfirmationRevision,
  getConfirmation,
  listSessionConfirmations,
  recordConfirmationOutcome,
} from "../lib/confirmations";
import { AI_ACTIONS } from "../registry/catalog";
import {
  AiProposalStoreError,
  canRunAiAction,
  type AiAction,
} from "../registry/define";

const isUuid = (value: string) => UuidSchema.safeParse(value).success;

const NO_CHAT = "No tenés permiso para usar el chat de IA.";
const NO_ACTION = "No tenés permiso para esta acción.";
const GONE = "Esta propuesta ya no está pendiente.";

/** The registry action behind a stored proposal, if it is still a proposal. */
function proposalAction(name: string): AiAction | undefined {
  return AI_ACTIONS.find((a) => a.name === name && a.proposal);
}

/** Proposal revisions of one of the caller's sessions (for the cards). */
export async function listAiConfirmationsAction(
  sessionId: string,
): Promise<ActionResult<AiConfirmation[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "ai:chat")) return { ok: false, error: NO_CHAT };
  if (!isUuid(sessionId)) return { ok: true, data: [] };
  try {
    return {
      ok: true,
      data: await listSessionConfirmations(ctx.userId, sessionId),
    };
  } catch (error) {
    logger.error("ai.confirmations.list_failed", {
      userId: ctx.userId,
      sessionId,
      error,
    });
    return { ok: false, error: "No se pudieron cargar las propuestas." };
  }
}

/**
 * Confirms a pending proposal and performs its write. Order: the caller's
 * `ai:chat` and the proposal's own permissions (the same the manual form
 * checks), the draft re-parsed with the form's schema, then the
 * compare-and-set claim — only the request that moves the row out of
 * `pending` runs the write, so a double click executes once.
 */
export async function confirmAiProposalAction(
  id: string,
): Promise<ActionResult<{ resultId: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "ai:chat")) return { ok: false, error: NO_CHAT };
  if (!isUuid(id)) return { ok: false, error: GONE };

  let row: AiConfirmation | null;
  try {
    row = await getConfirmation(ctx.userId, id);
  } catch (error) {
    logger.error("ai.confirmations.read_failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo leer la propuesta." };
  }
  if (!row || row.status !== "pending") return { ok: false, error: GONE };
  const action = proposalAction(row.action);
  if (!action?.proposal) return { ok: false, error: GONE };
  if (!canRunAiAction(ctx.access, action)) {
    return { ok: false, error: NO_ACTION };
  }
  const valid = action.proposal.spec.validate(row.draft, row.labels);
  if (!valid.ok) {
    return {
      ok: false,
      error: valid.issues[0]?.message ?? "La propuesta tiene datos inválidos.",
    };
  }

  let claimed: AiConfirmation | null;
  try {
    claimed = await claimConfirmation(ctx.userId, id, "confirmed");
  } catch (error) {
    logger.error("ai.confirmations.claim_failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo confirmar la propuesta." };
  }
  if (!claimed) return { ok: false, error: GONE };

  let res: ActionResult<{ id: string }>;
  try {
    res = await action.proposal.executeDraft(
      { userId: ctx.userId, access: ctx.access },
      valid.draft,
    );
  } catch (error) {
    logger.error("ai.proposal.execute_failed", {
      userId: ctx.userId,
      id,
      action: row.action,
      error,
    });
    res = { ok: false, error: "No se pudo completar la acción." };
  }
  await recordConfirmationOutcome(
    ctx.userId,
    id,
    res.ok ? { resultId: res.data.id } : { error: res.error },
  );
  await logAudit(
    res.ok ? "ai.proposal.confirmed" : "ai.proposal.failed",
    ctx.userId,
    {
      action: row.action,
      revision_key: row.revision_key,
      revision: row.revision,
      session_id: row.session_id,
      result_id: res.ok ? res.data.id : null,
    },
    id,
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, data: { resultId: res.data.id } };
}

/** Declines a pending proposal (compare-and-set; nothing is written). */
export async function declineAiProposalAction(
  id: string,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "ai:chat")) return { ok: false, error: NO_CHAT };
  if (!isUuid(id)) return { ok: false, error: GONE };
  let claimed: AiConfirmation | null;
  try {
    claimed = await claimConfirmation(ctx.userId, id, "declined");
  } catch (error) {
    logger.error("ai.confirmations.claim_failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo descartar la propuesta." };
  }
  if (!claimed) return { ok: false, error: GONE };
  await logAudit(
    "ai.proposal.declined",
    ctx.userId,
    {
      action: claimed.action,
      revision_key: claimed.revision_key,
      revision: claimed.revision,
      session_id: claimed.session_id,
    },
    id,
  );
  return { ok: true, data: undefined };
}

/**
 * The user's edit of a pending proposal from the card's Modify dialog: the
 * edited draft, held to the form's schema, becomes the next revision of the
 * same card and supersedes the one edited, only while that one is still
 * pending: an edit racing a confirm fails instead of reopening it. Labels
 * carry over: the editable fields never change which records the draft
 * points at.
 */
export async function reviseAiProposalAction(
  id: string,
  draft: unknown,
): Promise<ActionResult<AiConfirmation>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "ai:chat")) return { ok: false, error: NO_CHAT };
  if (!isUuid(id)) return { ok: false, error: GONE };

  let row: AiConfirmation | null;
  try {
    row = await getConfirmation(ctx.userId, id);
  } catch (error) {
    logger.error("ai.confirmations.read_failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo leer la propuesta." };
  }
  if (!row || row.status !== "pending") return { ok: false, error: GONE };
  const action = proposalAction(row.action);
  if (!action?.proposal) return { ok: false, error: GONE };
  if (!canRunAiAction(ctx.access, action)) {
    return { ok: false, error: NO_ACTION };
  }
  const { spec } = action.proposal;
  const edited = editedDraft(row.draft, draft, spec.fields);
  const valid = spec.validate(edited, row.labels);
  if (!valid.ok) {
    return {
      ok: false,
      error: valid.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  try {
    const stored = await createConfirmationRevision(
      ctx.userId,
      row.session_id,
      {
        toolCallId: row.tool_call_id,
        action: row.action,
        revisionKey: row.revision_key,
        draft: valid.draft,
        labels: row.labels,
        summary: valid.summary,
      },
      "user",
      row.id,
    );
    await logAudit(
      "ai.proposal.revised",
      ctx.userId,
      {
        action: row.action,
        revision_key: row.revision_key,
        revision: stored.revision,
        session_id: row.session_id,
      },
      stored.id,
    );
    const fresh = await getConfirmation(ctx.userId, stored.id);
    if (!fresh) return { ok: false, error: GONE };
    return { ok: true, data: fresh };
  } catch (error) {
    if (error instanceof AiProposalStoreError) {
      return { ok: false, error: GONE };
    }
    logger.error("ai.confirmations.revise_failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo guardar el cambio." };
  }
}

/**
 * The stored draft with only the spec's editable fields taken from the
 * user's edit: the dialog cannot repoint the draft (an employee id, account
 * ids) by sending extra keys.
 */
function editedDraft(
  stored: unknown,
  edit: unknown,
  fields: readonly { key: string }[],
): unknown {
  if (!isRecord(stored) || !isRecord(edit)) return stored;
  const next: Record<string, unknown> = { ...stored };
  for (const { key } of fields) {
    if (key in edit) next[key] = edit[key];
  }
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
