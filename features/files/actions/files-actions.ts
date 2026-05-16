"use server";

import { z } from "zod";

import { requireUserContext } from "@/lib/auth/context";
import { userCan, type Permission } from "@/lib/auth/permissions";
import { buildStorageKey } from "@/lib/files/storage-path";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

import {
  ATTACHMENT_KIND_BY_TARGET,
  AttachmentTargetSchema,
  type AttachmentTargetType,
  type FileAttachmentRow,
} from "../schema";

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const BUCKET = "files";
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

// Per-target write permission. The upload action requires `files:write`
// plus this — attach is gated by the user's right to write the target.
const TARGET_WRITE_PERMISSION: Record<AttachmentTargetType, Permission> = {
  purchase_invoice: "purchase_invoices:write",
  invoice:          "invoices:issue",
  receipt:          "receipts:write",
  payment_order:    "payment_orders:write",
  check:            "cheques:write",
  issued_check:     "issued_checks:write",
  client:           "clients:write",
  supplier:         "suppliers:write",
  transaction:      "transactions:write",
};

// FK column on file_attachments per target type.
const TARGET_FK_COLUMN: Record<AttachmentTargetType, string> = {
  purchase_invoice: "purchase_invoice_id",
  invoice:          "invoice_id",
  receipt:          "receipt_id",
  payment_order:    "payment_order_id",
  check:            "check_id",
  issued_check:     "issued_check_id",
  client:           "client_id",
  supplier:         "supplier_id",
  transaction:      "transaction_id",
};

// ─── uploadFileAction ────────────────────────────────────────────────────────
// Storage write first (bytes), then files row, then file_attachments row.
// Each step rolls back the previous on failure — RLS keeps half-built rows
// invisible, and the nightly orphan sweep is the safety net.

export async function uploadFileAction(
  formData: FormData,
): Promise<
  ActionResult<{ fileId: string; attachmentId: string }>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "files:write")) {
    return { ok: false, error: "Sin permiso para subir archivos." };
  }

  const targetParsed = AttachmentTargetSchema.safeParse({
    targetType: formData.get("targetType"),
    targetId: formData.get("targetId"),
  });
  if (!targetParsed.success) {
    return { ok: false, error: "Destino inválido." };
  }
  const { targetType, targetId } = targetParsed.data;

  if (!userCan(ctx.roles, TARGET_WRITE_PERMISSION[targetType])) {
    return { ok: false, error: "Sin permiso para atachar a esa entidad." };
  }

  const kind = String(formData.get("kind") ?? "");
  if (!ATTACHMENT_KIND_BY_TARGET[targetType].includes(kind)) {
    return { ok: false, error: `Tipo de adjunto inválido para ${targetType}.` };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "Archivo faltante." };
  }
  if (file.size === 0) {
    return { ok: false, error: "El archivo está vacío." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "El archivo supera 10 MB." };
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return { ok: false, error: `Tipo no permitido (${file.type || "desconocido"}).` };
  }

  const supabase = await createClient();
  const fileId = crypto.randomUUID();
  const bucketPath = buildStorageKey(fileId, file.name);

  const { error: storageErr } = await supabase.storage
    .from(BUCKET)
    .upload(bucketPath, file, { cacheControl: "3600", upsert: false });
  if (storageErr) {
    logger.warn("files.upload.storage_failed", { error: storageErr.message });
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
    source: "manual_upload",
  });
  if (registryErr) {
    await supabase.storage.from(BUCKET).remove([bucketPath]);
    logger.warn("files.upload.registry_failed", { error: registryErr.message });
    return { ok: false, error: "No se pudo registrar el archivo." };
  }

  // Insert per target so each branch stays typed. M.4 adds branches as new
  // FKs land on `file_attachments`.
  const baseInsert = {
    file_id: fileId,
    kind,
    created_by: ctx.userId,
  } as const;

  // Polimorfismo: una sola insert con el FK column dinámico, indexada
  // por TARGET_FK_COLUMN. La typing de supabase-js no permite la columna
  // dinámica directo, así que casteamos el payload.
  const fkColumn = TARGET_FK_COLUMN[targetType];
  const insertResult = await supabase
    .from("file_attachments")
    .insert({ ...baseInsert, [fkColumn]: targetId } as never)
    .select("id")
    .single();

  const attRow = insertResult.data;
  const attachErr = insertResult.error;
  if (attachErr || !attRow) {
    await supabase.from("files").delete().eq("id", fileId);
    await supabase.storage.from(BUCKET).remove([bucketPath]);
    logger.warn("files.upload.attach_failed", {
      error: attachErr?.message ?? "no row",
    });
    return { ok: false, error: "No se pudo asociar el archivo." };
  }

  return { ok: true, data: { fileId, attachmentId: attRow.id } };
}

// ─── getSignedFileUrlAction ──────────────────────────────────────────────────
// One-hour signed URL with Content-Disposition: attachment so the original
// filename surfaces on download. The RLS on `files` gates who can read.

export async function getSignedFileUrlAction(
  fileId: string,
): Promise<
  ActionResult<{ url: string; filename: string; mimeType: string | null }>
> {
  await requireUserContext();
  const parsed = z.string().uuid().safeParse(fileId);
  if (!parsed.success) {
    return { ok: false, error: "ID inválido." };
  }
  const supabase = await createClient();

  const { data: file, error: lookupErr } = await supabase
    .from("files")
    .select("bucket, bucket_path, original_filename, mime_type")
    .eq("id", parsed.data)
    .maybeSingle();
  if (lookupErr) {
    logger.warn("files.sign.lookup_failed", { error: lookupErr.message });
    return { ok: false, error: "Archivo no encontrado." };
  }
  if (!file) {
    return { ok: false, error: "Archivo no encontrado." };
  }

  const { data, error: signErr } = await supabase.storage
    .from(file.bucket)
    .createSignedUrl(file.bucket_path, 3600, {
      download: file.original_filename,
    });
  if (signErr || !data) {
    logger.warn("files.sign.create_url_failed", { error: signErr?.message });
    return { ok: false, error: "No se pudo generar la URL." };
  }

  return {
    ok: true,
    data: {
      url: data.signedUrl,
      filename: file.original_filename,
      mimeType: file.mime_type,
    },
  };
}

// ─── detachFileAction ────────────────────────────────────────────────────────
// Removes the attachment row; if no other attachments reference the file,
// also removes the blob + the registry row. The orphan sweep cron is the
// safety net for crashes mid-flow.

export async function detachFileAction(
  attachmentId: string,
): Promise<ActionResult<{ deletedBlob: boolean }>> {
  await requireUserContext();
  const parsed = z.string().uuid().safeParse(attachmentId);
  if (!parsed.success) {
    return { ok: false, error: "ID inválido." };
  }

  const supabase = await createClient();

  // Two-step lookup keeps the join out of the type inference path. Cheap
  // — both rows are tiny and the same supabase client is reused.
  const { data: attRow, error: loadErr } = await supabase
    .from("file_attachments")
    .select("file_id")
    .eq("id", parsed.data)
    .maybeSingle();
  if (loadErr || !attRow) {
    return { ok: false, error: "Adjunto no encontrado." };
  }

  const { data: fileRow, error: fileLookupErr } = await supabase
    .from("files")
    .select("bucket, bucket_path")
    .eq("id", attRow.file_id)
    .maybeSingle();
  if (fileLookupErr) {
    return { ok: false, error: fileLookupErr.message };
  }

  const { error: delErr } = await supabase
    .from("file_attachments")
    .delete()
    .eq("id", parsed.data);
  if (delErr) {
    return { ok: false, error: delErr.message };
  }

  const { count } = await supabase
    .from("file_attachments")
    .select("id", { count: "exact", head: true })
    .eq("file_id", attRow.file_id);

  if (count === 0 && fileRow) {
    await supabase.storage.from(fileRow.bucket).remove([fileRow.bucket_path]);
    await supabase.from("files").delete().eq("id", attRow.file_id);
    return { ok: true, data: { deletedBlob: true } };
  }

  return { ok: true, data: { deletedBlob: false } };
}

// ─── listAttachmentsAction ───────────────────────────────────────────────────
// Returns all attachments for a (targetType, targetId), newest first. The
// registry join filters out rows that may have been half-deleted by a crash
// — invariant under normal operation, defensive otherwise.

const ListSchema = AttachmentTargetSchema;

export async function listAttachmentsAction(
  input: unknown,
): Promise<ActionResult<FileAttachmentRow[]>> {
  await requireUserContext();
  const parsed = ListSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Parámetros inválidos." };
  }
  const { targetType, targetId } = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("file_attachments")
    .select(
      "id, kind, created_at, created_by, file_id, files!inner(original_filename, mime_type, file_size)",
    )
    .eq(TARGET_FK_COLUMN[targetType], targetId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.warn("files.list.failed", { error: error.message });
    return { ok: false, error: error.message };
  }

  const rows: FileAttachmentRow[] = (data ?? []).flatMap((row) => {
    const fileJoin = Array.isArray(row.files) ? row.files[0] : row.files;
    if (!fileJoin) return [];
    return [
      {
        attachmentId: row.id,
        fileId: row.file_id,
        kind: row.kind,
        attachedAt: row.created_at ?? new Date(0).toISOString(),
        createdBy: row.created_by,
        filename: fileJoin.original_filename,
        mimeType: fileJoin.mime_type,
        fileSize: fileJoin.file_size,
        targetType,
        targetId,
      },
    ];
  });

  return { ok: true, data: rows };
}
