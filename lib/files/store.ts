import "server-only";

import { buildStorageKey } from "@/lib/files/storage-path";
import { logger } from "@/lib/logger";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

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

  const { error: storageErr } = await supabase.storage
    .from(FILES_BUCKET)
    .upload(bucketPath, file, { cacheControl: "3600", upsert: false });
  if (storageErr) {
    logger.warn("files.upload.storage_failed", {
      userId,
      error: storageErr.message,
    });
    return { ok: false, error: "No se pudo subir el archivo." };
  }

  const { error: registryErr } = await supabase.from("files").insert({
    id: fileId,
    uploaded_by: userId,
    original_filename: file.name,
    mime_type: file.type,
    file_size: file.size,
    bucket: FILES_BUCKET,
    bucket_path: bucketPath,
    source: "manual_upload",
  });
  if (registryErr) {
    await supabase.storage.from(FILES_BUCKET).remove([bucketPath]);
    logger.warn("files.upload.registry_failed", {
      userId,
      error: registryErr.message,
    });
    return { ok: false, error: "No se pudo registrar el archivo." };
  }

  return { ok: true, data: { fileId, bucketPath } };
}

/** Undoes storeUploadedFile when linking the file failed. */
export async function discardStoredFile(
  supabase: Client,
  stored: StoredFile,
): Promise<void> {
  await supabase.from("files").delete().eq("id", stored.fileId);
  await supabase.storage.from(FILES_BUCKET).remove([stored.bucketPath]);
}

/**
 * A document may only point at a file the caller can see (RLS client) and
 * that is not a private AI chat attachment, so an id guessed or copied from
 * elsewhere can't be pulled into another module.
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
  if (error || !data || data.source === "chat_attachment") {
    return "No encontramos el archivo adjunto.";
  }
  return null;
}
