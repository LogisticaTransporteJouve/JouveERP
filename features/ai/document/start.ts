import "server-only";

import { logAudit } from "@/lib/actions/audit";
import { inngest } from "@/lib/inngest/client";
import { DOCUMENT_EXTRACTION_REQUESTED } from "@/lib/inngest/events";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { RateLimitError, enforceRateLimit } from "@/lib/rate-limit";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { checkAiDailyCap } from "../lib/chat-store";
import type { DocumentKind } from "./types";

// Starting a Document Intelligence extraction, shared by the Documentos
// actions and the chat's hand-off proposal. No gate here: callers check
// `ai:read` + `files:write` first.

export type StartExtractionInput = {
  fileId: string;
  declaredType?: DocumentKind | null;
};

/** Per-user extraction budget (each one = 1–3 vision calls). */
const EXTRACTION_RATE_LIMITS = {
  hourly: { key: "ai:document:hourly", max: 30, windowMs: 60 * 60 * 1000 },
  daily: { key: "ai:document:daily", max: 200, windowMs: 24 * 60 * 60 * 1000 },
} as const;

/**
 * Spend guards for Document Intelligence, same style as the chat route:
 * per-user hourly/daily rate limit (Postgres-backed, fail-closed) + the global
 * daily AI token cap (fail-closed). Returns a user-facing error, or null.
 */
export async function guardExtractionQuota(
  userId: string,
): Promise<string | null> {
  try {
    await enforceRateLimit({ userId, ...EXTRACTION_RATE_LIMITS.hourly });
    await enforceRateLimit({ userId, ...EXTRACTION_RATE_LIMITS.daily });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return "Alcanzaste el límite de escaneos con IA. Probá más tarde.";
    }
    throw err;
  }
  const cap = await checkAiDailyCap();
  if (cap === "exceeded") {
    return "Se alcanzó el límite diario de IA. Probá de nuevo mañana.";
  }
  if (cap === "unavailable") {
    return "No se pudo verificar el límite de IA. Probá de nuevo.";
  }
  return null;
}

/** Creates the draft + dispatches the pipeline. Callers did auth + quota. */
export async function startExtraction(
  userId: string,
  input: StartExtractionInput,
): Promise<ActionResult<{ extractionId: string }>> {
  const supabase = await createSupabaseClient();

  // Verify the caller can actually see this file (RLS client) before kicking
  // off a service-role download + vision calls — the file_id is user-supplied
  // and the pipeline bypasses RLS.
  const { data: file } = await supabase
    .from("files")
    .select("id")
    .eq("id", input.fileId)
    .maybeSingle();
  if (!file) return { ok: false, error: "No encontramos el archivo." };

  const { data, error } = await supabase
    .from("ai_document_extractions")
    .insert({ file_id: input.fileId, created_by: userId })
    .select("id")
    .single();
  if (error) {
    logger.error("ai.document.create_draft.failed", {
      userId,
      error,
    });
    return { ok: false, error: "No se pudo iniciar la extracción." };
  }

  try {
    await inngest.send({
      name: DOCUMENT_EXTRACTION_REQUESTED,
      data: {
        extraction_id: data.id,
        file_id: input.fileId,
        declared_type: input.declaredType ?? null,
      },
    });
  } catch (err) {
    logger.error("ai.document.dispatch.failed", { userId, error: err });
    await supabase.from("ai_document_extractions").delete().eq("id", data.id);
    return { ok: false, error: "No se pudo iniciar la extracción." };
  }

  await logAudit(
    "ai.document.extraction_requested",
    userId,
    { file_id: input.fileId, declared_type: input.declaredType ?? null },
    data.id,
  );
  return { ok: true, data: { extractionId: data.id } };
}

/** Quota guard + start, for a caller that already passed its gate. */
export async function startDocumentExtraction(
  userId: string,
  input: StartExtractionInput,
): Promise<ActionResult<{ extractionId: string }>> {
  const quotaError = await guardExtractionQuota(userId);
  if (quotaError) return { ok: false, error: quotaError };
  return startExtraction(userId, input);
}
