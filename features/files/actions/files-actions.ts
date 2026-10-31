"use server";

import { z } from "zod";

import { requireUserContext } from "@/lib/auth/context";
import { ENTITY_READ_PERMISSION } from "@/lib/auth/entity-permissions";
import { userCan, type Permission } from "@/lib/auth/permissions";
import { ATTACHMENT_FK_COLUMN } from "@/lib/files/attachment-targets";
import { isFileReferencedElsewhere } from "@/lib/files/references";
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

// Per-target write permission. The upload action requires `files:write`
// plus this — attach is gated by the user's right to write the target.
const TARGET_WRITE_PERMISSION: Record<AttachmentTargetType, Permission> = {
  purchase_invoice: "purchase_invoices:write",
  invoice: "invoices:issue",
  receipt: "receipts:write",
  payment_order: "payment_orders:write",
  check: "cheques:write",
  issued_check: "issued_checks:write",
  client: "clients:write",
  supplier: "suppliers:write",
  transaction: "transactions:write",
};

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

  if (!userCan(ctx.access, TARGET_WRITE_PERMISSION[targetType])) {
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

  return { ok: true, data: { fileId, attachmentId: attRow.id } };
}

const ATTACHMENT_TARGETS = Object.keys(ATTACHMENT_FK_COLUMN).filter(
  (t): t is keyof typeof ATTACHMENT_FK_COLUMN => t in ATTACHMENT_FK_COLUMN,
);

/** True unless every link points at an attachable entity the user's access
 *  cannot read. */
function canReadSomeLink(
  access: Parameters<typeof userCan>[0],
  links: readonly Partial<Record<string, string | null>>[],
): boolean {
  if (links.length === 0) return true;
  return links.some((link) => {
    const target = ATTACHMENT_TARGETS.find(
      (t) => link[ATTACHMENT_FK_COLUMN[t]] != null,
    );
    return (
      target === undefined || userCan(access, ENTITY_READ_PERMISSION[target])
    );
  });
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
  if (!userCan(ctx.access, "files:read")) {
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

  // A file attached only to entities whose module this user cannot read stays
  // hidden, as in the files hub. Links without an attachable entity (chat,
  // scanned documents) keep their own RLS.
  const { data: links, error: linksErr } = await supabase
    .from("file_attachments")
    .select(
      "purchase_invoice_id, invoice_id, receipt_id, payment_order_id, check_id, issued_check_id, client_id, supplier_id, transaction_id",
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
  if (!canReadSomeLink(ctx.access, links ?? [])) {
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

  if (
    count === 0 &&
    fileRow &&
    !(await isFileReferencedElsewhere(attRow.file_id))
  ) {
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
  if (!userCan(ctx.access, "files:read")) {
    return { ok: false, error: "No tenés permiso para ver archivos." };
  }
  const parsed = ListSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Parámetros inválidos." };
  }
  const { targetType, targetId } = parsed.data;
  if (!userCan(ctx.access, ENTITY_READ_PERMISSION[targetType])) {
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
