"use server";

import { z } from "zod";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Json } from "@/lib/db/database.types";
import { buildStorageKey } from "@/lib/files/storage-path";
import { inngest } from "@/lib/inngest/client";
import { DOCUMENT_EXTRACTION_REQUESTED } from "@/lib/inngest/events";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { DOCUMENT_KINDS } from "./types";

const BUCKET = "files";
const MAX_BYTES = 10 * 1024 * 1024;
const SCAN_ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const ExtractInputSchema = z.object({
  fileId: z.string().uuid(),
  declaredType: z.enum(DOCUMENT_KINDS).nullish(),
});

export type ExtractionFile = {
  original_filename: string;
  mime_type: string | null;
} | null;

export type PendingExtraction = {
  id: string;
  file_id: string;
  detected_type: string | null;
  confidence: number | null;
  status: string;
  matches: Json;
  created_at: string;
  file: ExtractionFile;
};

export type ExtractionDetail = PendingExtraction & { payload: Json };

const LIST_COLUMNS =
  "id, file_id, detected_type, confidence, status, matches, created_at, file:files(original_filename, mime_type)";

/**
 * Uploads a standalone document (not attached to any entity yet) and kicks off
 * extraction — the entry point for the generic Documentos tray. The document
 * type is inferred (classification); contextual flows pass a fileId straight to
 * extractDocumentAction.
 */
export async function scanDocumentAction(
  formData: FormData,
): Promise<ActionResult<{ extractionId: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:read") || !userCan(ctx.roles, "files:write")) {
    return { ok: false, error: "No tenés permiso para escanear documentos." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Archivo faltante." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "El archivo supera 10 MB." };
  }
  if (!SCAN_ALLOWED_MIME.has(file.type)) {
    return { ok: false, error: `Tipo no permitido (${file.type || "desconocido"}).` };
  }

  const supabase = await createSupabaseClient();
  const fileId = crypto.randomUUID();
  const bucketPath = buildStorageKey(fileId, file.name);

  const { error: storageErr } = await supabase.storage
    .from(BUCKET)
    .upload(bucketPath, file, { cacheControl: "3600", upsert: false });
  if (storageErr) {
    logger.warn("ai.document.upload.storage_failed", {
      userId: ctx.userId,
      error: storageErr.message,
    });
    return { ok: false, error: "No se pudo subir el archivo." };
  }

  const { error: registryErr } = await supabase.from("files").insert({
    id: fileId,
    uploaded_by: ctx.userId,
    original_filename: file.name,
    mime_type: file.type,
    file_size: file.size,
    bucket: BUCKET,
    bucket_path: bucketPath,
    source: "document_scan",
  });
  if (registryErr) {
    await supabase.storage.from(BUCKET).remove([bucketPath]);
    logger.warn("ai.document.upload.registry_failed", {
      userId: ctx.userId,
      error: registryErr.message,
    });
    return { ok: false, error: "No se pudo registrar el archivo." };
  }

  return extractDocumentAction({ fileId });
}

/**
 * Triggers Document Intelligence on an uploaded file: creates the draft row and
 * dispatches the Inngest pipeline (classify → extract → match → save).
 */
export async function extractDocumentAction(
  input: unknown,
): Promise<ActionResult<{ extractionId: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:read") || !userCan(ctx.roles, "files:write")) {
    return { ok: false, error: "No tenés permiso para escanear documentos." };
  }

  const parsed = ExtractInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const supabase = await createSupabaseClient();

  // Verify the caller can actually see this file (RLS client) before kicking
  // off a service-role download + vision calls — the file_id is user-supplied
  // and the pipeline bypasses RLS.
  const { data: file } = await supabase
    .from("files")
    .select("id")
    .eq("id", parsed.data.fileId)
    .maybeSingle();
  if (!file) return { ok: false, error: "No encontramos el archivo." };

  const { data, error } = await supabase
    .from("ai_document_extractions")
    .insert({ file_id: parsed.data.fileId, created_by: ctx.userId })
    .select("id")
    .single();
  if (error) {
    logger.error("ai.document.create_draft.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo iniciar la extracción." };
  }

  try {
    await inngest.send({
      name: DOCUMENT_EXTRACTION_REQUESTED,
      data: {
        extraction_id: data.id,
        file_id: parsed.data.fileId,
        declared_type: parsed.data.declaredType ?? null,
      },
    });
  } catch (err) {
    logger.error("ai.document.dispatch.failed", { userId: ctx.userId, error: err });
    await supabase.from("ai_document_extractions").delete().eq("id", data.id);
    return { ok: false, error: "No se pudo iniciar la extracción." };
  }

  await logAudit(
    "ai.document.extraction_requested",
    ctx.userId,
    { file_id: parsed.data.fileId, declared_type: parsed.data.declaredType ?? null },
    data.id,
  );
  return { ok: true, data: { extractionId: data.id } };
}

/** Lists the caller's drafts still awaiting review (RLS scoped; ai:admin sees all). */
export async function listPendingExtractionsAction(): Promise<
  ActionResult<PendingExtraction[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:read")) {
    return { ok: false, error: "No tenés permiso." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("ai_document_extractions")
    .select(LIST_COLUMNS)
    .eq("status", "pending_review")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    logger.error("ai.document.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron cargar los documentos." };
  }
  return { ok: true, data: data ?? [] };
}

/** Full draft (with extracted payload) for the review screen. */
export async function getExtractionAction(
  extractionId: string,
): Promise<ActionResult<ExtractionDetail | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:read")) {
    return { ok: false, error: "No tenés permiso." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("ai_document_extractions")
    .select(`${LIST_COLUMNS}, payload`)
    .eq("id", extractionId)
    .maybeSingle();
  if (error) {
    logger.error("ai.document.get.failed", {
      userId: ctx.userId,
      extractionId,
      error,
    });
    return { ok: false, error: "No se pudo cargar el documento." };
  }
  return { ok: true, data: data ?? null };
}

/** Discards a draft without creating anything. */
export async function discardExtractionAction(
  extractionId: string,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:read")) {
    return { ok: false, error: "No tenés permiso." };
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("ai_document_extractions")
    .update({ status: "discarded" })
    .eq("id", extractionId);
  if (error) {
    logger.error("ai.document.discard.failed", {
      userId: ctx.userId,
      extractionId,
      error,
    });
    return { ok: false, error: "No se pudo descartar." };
  }

  await logAudit("ai.document.discarded", ctx.userId, {}, extractionId);
  return { ok: true, data: undefined };
}
