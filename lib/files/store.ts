import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/db/database.types";
import { isLinkedFile } from "@/lib/files/references";
import { buildStorageKey } from "@/lib/files/storage-path";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

/** The caller's RLS client or the service role, as each writer needs. */
type Client = SupabaseClient<Database>;

export const FILES_BUCKET = "files";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export type StoredFile = { fileId: string; bucketPath: string };

/**
 * Validates an uploaded file, writes the blob and then its `files` row (with
 * the caller's RLS client), removing the blob if the row fails. The file is
 * linked to nothing yet: the caller links it, and the orphan sweep removes it
 * if that never happens.
 */
export async function storeUploadedFile(
  supabase: Client,
  userId: string,
  file: unknown,
): Promise<{ ok: true; data: StoredFile } | { ok: false; error: string }> {
  if (!(file instanceof File)) return { ok: false, error: "Archivo faltante." };
  if (file.size === 0) return { ok: false, error: "El archivo está vacío." };
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "El archivo supera 10 MB." };
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return {
      ok: false,
      error: `Tipo no permitido (${file.type || "desconocido"}).`,
    };
  }

  const fileId = crypto.randomUUID();
  const bucketPath = buildStorageKey(fileId, file.name);
  const written = await writeFileBlobAndRow(supabase, {
    fileId,
    bucketPath,
    body: file,
    userId,
    filename: file.name,
    mimeType: file.type,
    size: file.size,
    source: "manual_upload",
    logPrefix: "files.upload",
  });
  if (written === "storage_failed") {
    return { ok: false, error: "No se pudo subir el archivo." };
  }
  if (written === "registry_failed") {
    return { ok: false, error: "No se pudo registrar el archivo." };
  }
  return { ok: true, data: { fileId, bucketPath } };
}

/**
 * Writes a file's bytes and then its `files` row; if the row fails the bytes
 * are removed, so a failure leaves neither. The one place every upload path
 * (attachments, document scans, chat drafts) registers a file. The caller has
 * already validated the file and passed its gate.
 *
 * The bytes are removed with the service role: a storage delete under the
 * caller's session also needs `files_storage_select`, which asks for the very
 * row that failed, so it would find nothing and leave the bytes behind.
 */
export async function writeFileBlobAndRow(
  supabase: Client,
  input: {
    fileId: string;
    bucketPath: string;
    body: File | Uint8Array;
    userId: string;
    filename: string;
    mimeType: string;
    size: number;
    source: string;
    metadata?: { [key: string]: Json };
    /** Telemetry slug prefix, e.g. "files.upload". */
    logPrefix: string;
  },
): Promise<"ok" | "storage_failed" | "registry_failed"> {
  const { error: storageErr } = await supabase.storage
    .from(FILES_BUCKET)
    .upload(input.bucketPath, input.body, {
      contentType: input.mimeType,
      cacheControl: "3600",
      upsert: false,
    });
  if (storageErr) {
    logger.warn(`${input.logPrefix}.storage_failed`, {
      userId: input.userId,
      error: storageErr.message,
    });
    return "storage_failed";
  }

  const { error: registryErr } = await supabase.from("files").insert({
    id: input.fileId,
    uploaded_by: input.userId,
    original_filename: input.filename,
    mime_type: input.mimeType,
    file_size: input.size,
    bucket: FILES_BUCKET,
    bucket_path: input.bucketPath,
    source: input.source,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
  if (registryErr) {
    const { error: removeErr } = await getServiceClient()
      .storage.from(FILES_BUCKET)
      .remove([input.bucketPath]);
    logger.warn(`${input.logPrefix}.registry_failed`, {
      userId: input.userId,
      error: registryErr.message,
      // Bytes with no row: nothing signs them, but they stay in the bucket.
      blobRemoveError: removeErr?.message ?? null,
    });
    return "registry_failed";
  }
  return "ok";
}

/**
 * Undoes storeUploadedFile / writeFileBlobAndRow when linking the file
 * failed: the row first, with the caller's client (it can delete only its own
 * upload), then the bytes only once the row is gone (bytes removed under a
 * surviving row would leave a file nobody can open). The bytes go with the
 * service role: with the row deleted, the caller's storage delete no longer
 * sees them. A failure is logged and left to the orphan sweep.
 */
export async function discardStoredFile(
  supabase: Client,
  stored: StoredFile,
): Promise<void> {
  const { data, error } = await supabase
    .from("files")
    .delete()
    .eq("id", stored.fileId)
    .select("id");
  if (error || (data ?? []).length === 0) {
    logger.warn("files.discard.row_failed", {
      fileId: stored.fileId,
      error: error?.message ?? "no row deleted",
    });
    return;
  }
  const { error: removeErr } = await getServiceClient()
    .storage.from(FILES_BUCKET)
    .remove([stored.bucketPath]);
  if (removeErr) {
    logger.warn("files.discard.storage_failed", {
      fileId: stored.fileId,
      error: removeErr.message,
    });
  }
}

/** The guard's message in 20261105130100 (guard_link_file_visible). */
const FILE_ALREADY_LINKED = "Ese archivo ya está vinculado a otro registro.";
const FILE_READ_FAILED = "No se pudo leer el archivo adjunto. Reintentá.";

/**
 * A fleet or employee document may only point at a file the caller can see
 * (RLS client), that is not a private AI chat attachment, and that nothing
 * else links yet (an attachment, a scan or another document): the fleet and
 * HR ceilings on `files` would otherwise hide that file from the roles that
 * read it through its other link. The database refuses the same
 * (guard_link_file_visible). Call it only after the action's permission
 * check: the link lookup uses the service role.
 */
export async function linkableFileError(
  supabase: Client,
  fileId: string | null | undefined,
): Promise<string | null> {
  if (!fileId) return null;
  const { data, error } = await supabase
    .from("files")
    .select("id, source")
    .eq("id", fileId)
    .maybeSingle();
  if (error) {
    logger.warn("files.linkable.read_failed", { fileId, error: error.message });
    return FILE_READ_FAILED;
  }
  if (!data || data.source === "chat_attachment") {
    return "No encontramos el archivo adjunto.";
  }
  const linked = await isLinkedFile(fileId);
  if (linked === null) return FILE_READ_FAILED;
  return linked ? FILE_ALREADY_LINKED : null;
}
