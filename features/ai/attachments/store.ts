import "server-only";

import type { Json } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { CHAT_ATTACHMENT_SOURCE, type ChatAttachmentOwnership } from "./access";
import {
  readAttachmentMetadata,
  type DownloadFile,
  type StoredAttachment,
} from "./content";
import type { ChatAttachment } from "./schema";

// Chat attachment persistence. Every function runs with the service client
// and is called only after the caller's gate (`ai:chat`) with the user id the
// session resolved; ownership is checked here, never taken from the client.

const BUCKET = "files";

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export type ClaimResult =
  { ok: true; attachments: ChatAttachment[] } | { ok: false; error: string };

/**
 * The draft uploads `fileIds` as attachments of a new message: each one must
 * be the caller's own chat upload and not yet linked to a message. Metadata
 * comes from the registry, never from the client.
 */
export async function claimDraftAttachments(
  userId: string,
  fileIds: readonly string[],
): Promise<ClaimResult> {
  const ids = Array.from(new Set(fileIds));
  if (ids.length === 0) return { ok: true, attachments: [] };
  const service = getServiceClient();
  const { data: files, error } = await service
    .from("files")
    .select("id, original_filename, mime_type, file_size, uploaded_by, source")
    .in("id", ids);
  if (error) throw error;
  const byId = new Map((files ?? []).map((f) => [f.id, f]));
  const attachments: ChatAttachment[] = [];
  for (const id of ids) {
    const f = byId.get(id);
    if (
      !f ||
      f.uploaded_by !== userId ||
      f.source !== CHAT_ATTACHMENT_SOURCE ||
      !f.mime_type
    ) {
      return {
        ok: false,
        error: "Un adjunto ya no está disponible. Volvé a subirlo.",
      };
    }
    attachments.push({
      fileId: f.id,
      filename: f.original_filename,
      mimeType: f.mime_type,
      size: f.file_size ?? 0,
    });
  }
  const { data: linked, error: linkedError } = await service
    .from("file_attachments")
    .select("file_id")
    .in("file_id", ids)
    .limit(1);
  if (linkedError) throw linkedError;
  if ((linked ?? []).length > 0) {
    return { ok: false, error: "Ese adjunto ya se envió en otro mensaje." };
  }
  return { ok: true, attachments };
}

/** Links claimed uploads to the persisted message row. Throws on conflict. */
export async function linkAttachmentsToMessage(
  userId: string,
  messageRowId: string,
  fileIds: readonly string[],
): Promise<void> {
  if (fileIds.length === 0) return;
  const service = getServiceClient();
  const { error } = await service.from("file_attachments").insert(
    fileIds.map((fileId) => ({
      file_id: fileId,
      ai_chat_message_id: messageRowId,
      kind: CHAT_ATTACHMENT_SOURCE,
      created_by: userId,
    })),
  );
  if (error) throw error;
}

/** The attachments linked to messages of `sessionId`, by file id. */
export async function listSessionAttachments(
  sessionId: string,
): Promise<Map<string, StoredAttachment>> {
  const service = getServiceClient();
  const { data, error } = await service
    .from("file_attachments")
    .select(
      "file_id, files!inner(mime_type, file_size, bucket, bucket_path, metadata), ai_chat_messages!inner(session_id)",
    )
    .eq("ai_chat_messages.session_id", sessionId);
  if (error) throw error;
  const out = new Map<string, StoredAttachment>();
  for (const row of data ?? []) {
    const file = one(row.files);
    if (!file?.mime_type) continue;
    out.set(row.file_id, {
      fileId: row.file_id,
      mimeType: file.mime_type,
      size: file.file_size ?? 0,
      ...readAttachmentMetadata(file.metadata),
      bucket: file.bucket,
      bucketPath: file.bucket_path,
    });
  }
  return out;
}

export const downloadStoredFile: DownloadFile = async (bucket, path) => {
  const { data, error } = await getServiceClient()
    .storage.from(bucket)
    .download(path);
  if (error || !data) {
    logger.warn("ai.attachments.download_failed", { bucket, error });
    return null;
  }
  return new Uint8Array(await data.arrayBuffer());
};

export type ChatAttachmentFile = ChatAttachmentOwnership & {
  fileId: string;
  bucket: string;
  bucketPath: string;
  filename: string;
  mimeType: string | null;
};

/** A file with what decides who may open it as a chat attachment. */
export async function loadChatAttachmentFile(
  fileId: string,
): Promise<ChatAttachmentFile | null> {
  const service = getServiceClient();
  const { data: file, error } = await service
    .from("files")
    .select(
      "id, bucket, bucket_path, original_filename, mime_type, uploaded_by, source",
    )
    .eq("id", fileId)
    .maybeSingle();
  if (error) throw error;
  if (!file) return null;
  const { data: link, error: linkError } = await service
    .from("file_attachments")
    .select(
      "ai_chat_messages!inner(session_id, ai_chat_sessions!inner(user_id))",
    )
    .eq("file_id", fileId)
    .not("ai_chat_message_id", "is", null)
    .maybeSingle();
  if (linkError) throw linkError;
  const session = one(one(link?.ai_chat_messages)?.ai_chat_sessions);
  return {
    fileId: file.id,
    bucket: file.bucket,
    bucketPath: file.bucket_path,
    filename: file.original_filename,
    mimeType: file.mime_type,
    source: file.source,
    uploadedBy: file.uploaded_by,
    sessionOwner: session?.user_id ?? null,
  };
}

export async function signStoredFile(
  file: Pick<ChatAttachmentFile, "bucket" | "bucketPath" | "filename">,
  download: boolean,
): Promise<string | null> {
  const { data, error } = await getServiceClient()
    .storage.from(file.bucket)
    .createSignedUrl(file.bucketPath, 3600, {
      download: download ? file.filename : false,
    });
  if (error || !data) {
    logger.warn("ai.attachments.sign_failed", { error });
    return null;
  }
  return data.signedUrl;
}

/** Stores a validated upload as an unsent chat draft (bytes, then row). */
export async function storeDraftAttachment(input: {
  userId: string;
  fileId: string;
  bucketPath: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  metadata: { [key: string]: Json };
}): Promise<boolean> {
  const service = getServiceClient();
  const { error: storageError } = await service.storage
    .from(BUCKET)
    .upload(input.bucketPath, input.bytes, {
      contentType: input.mimeType,
      cacheControl: "3600",
      upsert: false,
    });
  if (storageError) {
    logger.warn("ai.attachments.upload_failed", {
      userId: input.userId,
      error: storageError.message,
    });
    return false;
  }
  const { error } = await service.from("files").insert({
    id: input.fileId,
    uploaded_by: input.userId,
    original_filename: input.filename,
    mime_type: input.mimeType,
    file_size: input.bytes.byteLength,
    bucket: BUCKET,
    bucket_path: input.bucketPath,
    source: CHAT_ATTACHMENT_SOURCE,
    metadata: input.metadata,
  });
  if (error) {
    await service.storage.from(BUCKET).remove([input.bucketPath]);
    logger.warn("ai.attachments.register_failed", {
      userId: input.userId,
      error: error.message,
    });
    return false;
  }
  return true;
}

/**
 * Deletes the caller's unsent draft (row, then blob) in one conditional
 * statement: a file linked to a message, read by Document Intelligence or
 * someone else's is left alone (delete_chat_draft_file).
 */
export async function deleteDraftAttachment(
  userId: string,
  fileId: string,
): Promise<boolean> {
  const service = getServiceClient();
  const { data, error } = await service.rpc("delete_chat_draft_file", {
    p_file_id: fileId,
    p_user_id: userId,
  });
  if (error) throw error;
  const deleted = (data ?? [])[0];
  if (!deleted) return false;
  await service.storage.from(deleted.bucket).remove([deleted.bucket_path]);
  return true;
}

/**
 * Marks a chat attachment the model API refused, so later turns send a note
 * instead of the file (files.metadata.unreadable).
 */
export async function markAttachmentUnreadable(fileId: string): Promise<void> {
  const service = getServiceClient();
  const { data, error } = await service
    .from("files")
    .select("metadata")
    .eq("id", fileId)
    .eq("source", CHAT_ATTACHMENT_SOURCE)
    .maybeSingle();
  if (error) throw error;
  if (!data) return;
  const current =
    typeof data.metadata === "object" &&
    data.metadata !== null &&
    !Array.isArray(data.metadata)
      ? data.metadata
      : {};
  const { error: updateError } = await service
    .from("files")
    .update({ metadata: { ...current, unreadable: true } })
    .eq("id", fileId);
  if (updateError) throw updateError;
}

/**
 * The caller's chat attachment (linked to a message of one of their own
 * sessions), for the Document Intelligence hand-off. Null otherwise.
 */
export async function findOwnSentAttachment(
  userId: string,
  fileId: string,
): Promise<ChatAttachmentFile | null> {
  const file = await loadChatAttachmentFile(fileId);
  if (!file || file.source !== CHAT_ATTACHMENT_SOURCE) return null;
  return file.sessionOwner === userId ? file : null;
}

/** True when Document Intelligence already has a draft for the file. */
export async function hasDocumentExtraction(fileId: string): Promise<boolean> {
  const { data, error } = await getServiceClient()
    .from("ai_document_extractions")
    .select("id")
    .eq("file_id", fileId)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}
