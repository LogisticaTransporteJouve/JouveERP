"use server";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { UuidSchema } from "@/lib/validation/common";

import { runArtifact } from "../artifacts/run";
import {
  ARTIFACT_LIMITS,
  pinRequestOf,
  pinRequestSchema,
  type Artifact,
} from "../artifacts/spec";
import {
  deletePin,
  getPin,
  insertPin,
  listPins,
  type AiPinnedArtifact,
} from "../lib/pinned-artifacts";

const NO_CHAT = "No tenés permiso para usar el chat de IA.";
const NO_SOURCE = "No tenés permiso para esta consulta.";
const GONE = "Ese elemento fijado ya no existe.";

/** A pinned card's content, recomputed now as the viewer. */
export type AiPinnedView =
  | { status: "ok"; artifact: Artifact }
  | { status: "denied" }
  | { status: "error"; message: string };

/**
 * Pins a chart or table. Only the source query, its input and the config
 * arrive from the client — never rows: the query runs here as the caller
 * (its own permission gate and input schema apply), and what gets stored is
 * the parsed input and the config the artifact resolved to.
 */
export async function pinAiArtifactAction(
  request: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "ai:chat")) return { ok: false, error: NO_CHAT };
  const parsed = pinRequestSchema.safeParse(request);
  if (!parsed.success) {
    return { ok: false, error: "No se pudo fijar: datos inválidos." };
  }

  const run = await runArtifact(
    { userId: ctx.userId, access: ctx.access },
    parsed.data,
  );
  if (!run.ok) {
    return {
      ok: false,
      error: run.denied ? NO_SOURCE : "No se pudo recalcular para fijarlo.",
    };
  }
  const resolved = pinRequestOf(run.artifact);
  const stored = {
    ...resolved,
    source: { action: resolved.source.action, input: run.input },
  };
  const checked = pinRequestSchema.safeParse(stored);
  if (!checked.success) {
    return { ok: false, error: "No se pudo fijar: datos inválidos." };
  }

  try {
    const inserted = await insertPin(ctx.userId, checked.data);
    if (!inserted.ok) {
      return {
        ok: false,
        error:
          inserted.reason === "duplicate"
            ? "Ya lo tenías fijado."
            : `Podés fijar hasta ${ARTIFACT_LIMITS.pinsPerUser} elementos. Quitá alguno para sumar otro.`,
      };
    }
    const { id } = inserted;
    await logAudit(
      "ai.artifact.pinned",
      ctx.userId,
      { kind: checked.data.kind, action: checked.data.source.action },
      id,
    );
    return { ok: true, data: { id } };
  } catch (error) {
    logger.error("ai.pins.insert_failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo fijar." };
  }
}

export async function unpinAiArtifactAction(
  id: string,
): Promise<ActionResult<void>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "ai:chat")) return { ok: false, error: NO_CHAT };
  if (!UuidSchema.safeParse(id).success) return { ok: false, error: GONE };
  try {
    if (!(await deletePin(ctx.userId, id))) return { ok: false, error: GONE };
  } catch (error) {
    logger.error("ai.pins.delete_failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo quitar." };
  }
  await logAudit("ai.artifact.unpinned", ctx.userId, {}, id);
  return { ok: true, data: undefined };
}

/** The caller's pins, without their data. */
export async function listAiPinnedArtifactsAction(): Promise<
  ActionResult<AiPinnedArtifact[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "ai:chat")) return { ok: false, error: NO_CHAT };
  try {
    return { ok: true, data: await listPins(ctx.userId) };
  } catch (error) {
    logger.error("ai.pins.list_failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron cargar los fijados." };
  }
}

/**
 * Recomputes one pin as the caller, with the permissions they hold now: a
 * pin whose query they can no longer run comes back `denied`, with no data.
 */
export async function loadAiPinnedArtifactAction(
  id: string,
): Promise<ActionResult<AiPinnedView>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "ai:chat")) return { ok: false, error: NO_CHAT };
  if (!UuidSchema.safeParse(id).success) return { ok: false, error: GONE };

  let pin: AiPinnedArtifact | null;
  try {
    pin = await getPin(ctx.userId, id);
  } catch (error) {
    logger.error("ai.pins.read_failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo cargar." };
  }
  if (!pin) return { ok: false, error: GONE };

  const run = await runArtifact(
    { userId: ctx.userId, access: ctx.access },
    pin.request,
  );
  if (run.ok)
    return { ok: true, data: { status: "ok", artifact: run.artifact } };
  if (run.denied) return { ok: true, data: { status: "denied" } };
  return {
    ok: true,
    data: {
      status: "error",
      message: "No se pudo recalcular con los datos actuales.",
    },
  };
}
