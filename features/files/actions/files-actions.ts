"use server";

import { z } from "zod";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { ENTITY_READ_PERMISSION } from "@/lib/auth/entity-permissions";
import { userCan } from "@/lib/auth/permissions";
import {
  ATTACHMENT_FK_COLUMN,
  ATTACHMENT_WRITE_PERMISSION,
  canChangeAttachments,
} from "@/lib/files/attachment-targets";
import {
  isDocumentScanFile,
  isFileStillReferenced,
} from "@/lib/files/references";
import { discardStoredFile, storeUploadedFile } from "@/lib/files/store";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

import {
  ATTACHMENT_KIND_BY_TARGET,
  AttachmentTargetSchema,
  type AttachmentTargetType,
  type FileAttachmentRow,
} from "../schema";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const TARGET_FK_COLUMN: Record<AttachmentTargetType, string> =
  ATTACHMENT_FK_COLUMN;

// ─── uploadFileAction ────────────────────────────────────────────────────────
// Storage write first (bytes), then files row (storeUploadedFile), then
// file_attachments row. Each step rolls back the previous on failure — RLS
// keeps half-built rows invisible, and the nightly orphan sweep is the safety
// net.

export async function uploadFileAction(
  formData: FormData,
): Promise<ActionResult<{ fileId: string; attachmentId: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "files:write")) {
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

  if (!userCan(ctx.access, ATTACHMENT_WRITE_PERMISSION[targetType])) {
    return { ok: false, error: "Sin permiso para atachar a esa entidad." };
  }

  const kind = String(formData.get("kind") ?? "");
  if (!ATTACHMENT_KIND_BY_TARGET[targetType].includes(kind)) {
    return { ok: false, error: `Tipo de adjunto inválido para ${targetType}.` };
  }

  const supabase = await createClient();
  const stored = await storeUploadedFile(
    supabase,
    ctx.userId,
    formData.get("file"),
  );
  if (!stored.ok) return stored;
  const { fileId } = stored.data;

  // Insert per target so each branch stays typed. M.4 adds branches as new
  // FKs land on `file_attachments`.
  const baseInsert = {
    file_id: fileId,
    kind,
    created_by: ctx.userId,
  } as const;

  // Polymorphism: a single insert with the dynamic FK column, indexed
  // by TARGET_FK_COLUMN. supabase-js typing doesn't allow the dynamic
  // column directly, so we cast the payload.
  const fkColumn = TARGET_FK_COLUMN[targetType];
  const insertResult = await supabase
    .from("file_attachments")
    .insert({ ...baseInsert, [fkColumn]: targetId } as never)
    .select("id")
    .single();

  const attRow = insertResult.data;
  const attachErr = insertResult.error;
  if (attachErr || !attRow) {
    await discardStoredFile(supabase, stored.data);
    logger.warn("files.upload.attach_failed", {
      userId: ctx.userId,
      targetType,
      targetId,
      error: attachErr?.message ?? "no row",
    });
    return { ok: false, error: "No se pudo asociar el archivo." };
  }

  await logAudit(
    "file.attached",
    ctx.userId,
    {
      target_type: targetType,
      kind,
      file_id: fileId,
      attachment_id: attRow.id,
    },
    targetId,
  );
  return { ok: true, data: { fileId, attachmentId: attRow.id } };
}

const ATTACHMENT_TARGETS = Object.keys(ATTACHMENT_FK_COLUMN).filter(
  (t): t is keyof typeof ATTACHMENT_FK_COLUMN => t in ATTACHMENT_FK_COLUMN,
);

/** True when some link is to an entity the user's access reads, or to no
 *  attachable entity (chat, which keeps its own RLS). */
function canReadSomeLink(
  access: Parameters<typeof userCan>[0],
  links: readonly Partial<Record<string, string | null>>[],
): boolean {
  return links.some((link) => {
    const target = ATTACHMENT_TARGETS.find(
      (t) => link[ATTACHMENT_FK_COLUMN[t]] != null,
    );
    return (
      target === undefined || userCan(access, ENTITY_READ_PERMISSION[target])
    );
  });
}

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Whether a Document Intelligence scan opens for this user: ai:read and an
 * extraction of the file their RLS returns (their own, any for owner/admin),
 * the rule of the review screen. "not_scan" when no extraction reads the file.
 */
async function scanAccess(
  supabase: Client,
  access: Parameters<typeof userCan>[0],
  fileId: string,
): Promise<"allowed" | "refused" | "not_scan"> {
  const isScan = await isDocumentScanFile(fileId);
  if (isScan === null) return "refused";
  if (!isScan) return "not_scan";
  if (!userCan(access, "ai:read")) return "refused";
  const { data, error } = await supabase
    .from("ai_document_extractions")
    .select("id")
    .eq("file_id", fileId)
    .limit(1);
  return error || (data ?? []).length === 0 ? "refused" : "allowed";
}

/** files:read opens every attachment the module gates allow. Without it,
 *  a taxes:read holder (the accountant) opens only a tax document's: the
 *  scoped read the RLS on files and file_attachments also grants
 *  (20261104050400). */
function canReadFilesOf(
  access: Parameters<typeof userCan>[0],
  target: AttachmentTargetType | "any",
): boolean {
  if (userCan(access, "files:read")) return true;
  return (
    (target === "tax_document" || target === "any") &&
    userCan(access, "taxes:read")
  );
}

// ─── getSignedFileUrlAction ──────────────────────────────────────────────────
// One-hour signed URL with Content-Disposition: attachment so the original
// filename surfaces on download. The RLS on `files` gates who can read.

export async function getSignedFileUrlAction(
  fileId: string,
): Promise<
  ActionResult<{ url: string; filename: string; mimeType: string | null }>
> {
  const ctx = await requireUserContext();
  if (!canReadFilesOf(ctx.access, "any")) {
    return { ok: false, error: "No tenés permiso para ver archivos." };
  }
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
    logger.warn("files.sign.lookup_failed", {
      userId: ctx.userId,
      fileId: parsed.data,
      error: lookupErr.message,
    });
    return { ok: false, error: "Archivo no encontrado." };
  }
  if (!file) {
    return { ok: false, error: "Archivo no encontrado." };
  }

  // HR documents: only hr:read (RLS on `files` agrees; this is the action's
  // own check, independent of the policy).
  if (!userCan(ctx.access, "hr:read")) {
    const { data: isHrFile, error: hrErr } = await supabase.rpc(
      "is_employee_document_file",
      { p_file_id: parsed.data },
    );
    if (hrErr || isHrFile) {
      return { ok: false, error: "Archivo no encontrado." };
    }
  }

  // Fleet documents: only fleet_documents:read, the same pair of checks.
  if (!userCan(ctx.access, "fleet_documents:read")) {
    const { data: isFleetFile, error: fleetErr } = await supabase.rpc(
      "is_fleet_document_file",
      { p_file_id: parsed.data },
    );
    if (fleetErr || isFleetFile) {
      return { ok: false, error: "Archivo no encontrado." };
    }
  }

  // A file is opened through a record this user can read, as in the files
  // hub: an attachment whose entity's module they read, or the scan they may
  // review. A link without an attachable entity (chat) keeps its own RLS.
  const { data: links, error: linksErr } = await supabase
    .from("file_attachments")
    .select(
      "purchase_invoice_id, invoice_id, receipt_id, payment_order_id, check_id, issued_check_id, client_id, supplier_id, transaction_id, fuel_load_id, tax_document_id",
    )
    .eq("file_id", parsed.data);
  if (linksErr) {
    logger.warn("files.sign.links_failed", {
      userId: ctx.userId,
      fileId: parsed.data,
      error: linksErr.message,
    });
    return { ok: false, error: "Archivo no encontrado." };
  }
  const linkRows = links ?? [];
  if (linkRows.length === 0 || !canReadSomeLink(ctx.access, linkRows)) {
    const scan = await scanAccess(supabase, ctx.access, parsed.data);
    if (scan === "refused" || (scan === "not_scan" && linkRows.length > 0)) {
      return { ok: false, error: "Archivo no encontrado." };
    }
  }
  // Without files:read, only a file a tax document has attached.
  if (
    !userCan(ctx.access, "files:read") &&
    !linkRows.some((l) => l.tax_document_id != null)
  ) {
    return { ok: false, error: "Archivo no encontrado." };
  }

  const { data, error: signErr } = await supabase.storage
    .from(file.bucket)
    .createSignedUrl(file.bucket_path, 3600, {
      download: file.original_filename,
    });
  if (signErr || !data) {
    logger.warn("files.sign.create_url_failed", {
      userId: ctx.userId,
      fileId: parsed.data,
      error: signErr?.message,
    });
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
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "files:write")) {
    return { ok: false, error: "No tenés permiso para modificar archivos." };
  }
  const parsed = z.string().uuid().safeParse(attachmentId);
  if (!parsed.success) {
    return { ok: false, error: "ID inválido." };
  }

  const supabase = await createClient();

  // Two-step lookup keeps the join out of the type inference path. Cheap
  // — both rows are tiny and the same supabase client is reused.
  const { data: attRow, error: loadErr } = await supabase
    .from("file_attachments")
    .select(
      "file_id, kind, purchase_invoice_id, invoice_id, receipt_id, payment_order_id, check_id, issued_check_id, client_id, supplier_id, transaction_id, fuel_load_id, tax_document_id",
    )
    .eq("id", parsed.data)
    .maybeSingle();
  if (loadErr || !attRow) {
    return { ok: false, error: "Adjunto no encontrado." };
  }

  // The entity it was attached to: removing its file is a write on it, as
  // attaching one is, and the event lands in that record's history.
  const target = ATTACHMENT_TARGETS.find(
    (t) => attRow[ATTACHMENT_FK_COLUMN[t]] != null,
  );
  if (!target || !canChangeAttachments(ctx.access, target)) {
    return { ok: false, error: "No tenés permiso para modificar archivos." };
  }

  const { data: fileRow, error: fileLookupErr } = await supabase
    .from("files")
    .select("bucket, bucket_path")
    .eq("id", attRow.file_id)
    .maybeSingle();
  if (fileLookupErr) {
    return { ok: false, error: fileLookupErr.message };
  }

  // RLS lets only the link's creator or owner/admin delete it; any other
  // caller deletes no row, which is not a detach.
  const { data: deleted, error: delErr } = await supabase
    .from("file_attachments")
    .delete()
    .eq("id", parsed.data)
    .select("id");
  if (delErr) {
    return { ok: false, error: delErr.message };
  }
  if ((deleted ?? []).length === 0) {
    return { ok: false, error: "Solo quien lo adjuntó o un admin lo quita." };
  }

  await logAudit(
    "file.detached",
    ctx.userId,
    {
      target_type: target,
      kind: attRow.kind,
      file_id: attRow.file_id,
      attachment_id: parsed.data,
    },
    attRow[ATTACHMENT_FK_COLUMN[target]] ?? undefined,
  );

  if (fileRow && !(await isFileStillReferenced(attRow.file_id))) {
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
  const ctx = await requireUserContext();
  const parsed = ListSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Parámetros inválidos." };
  }
  const { targetType, targetId } = parsed.data;
  if (
    !canReadFilesOf(ctx.access, targetType) ||
    !userCan(ctx.access, ENTITY_READ_PERMISSION[targetType])
  ) {
    return { ok: false, error: "No tenés permiso para ver archivos." };
  }
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("file_attachments")
    .select(
      "id, kind, created_at, created_by, file_id, files!inner(original_filename, mime_type, file_size)",
    )
    .eq(TARGET_FK_COLUMN[targetType], targetId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.warn("files.list.failed", {
      userId: ctx.userId,
      targetType,
      targetId,
      error: error.message,
    });
    return { ok: false, error: "No se pudieron leer los adjuntos." };
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
