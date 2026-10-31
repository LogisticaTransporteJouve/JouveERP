"use server";

import { logAudit } from "@/lib/actions/audit";
import type { JsonValue } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";
import {
  discardStoredFile,
  linkableFileError,
  storeUploadedFile,
} from "@/lib/files/store";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { paginateRange } from "@/lib/supabase/paginate";

import {
  FleetDocumentCreateSchema,
  FleetDocumentFileSchema,
  FleetDocumentUpdateSchema,
  isFleetDocKind,
  type FleetDocument,
} from "../schema";

type FleetDocumentSelectRow = Pick<
  Database["public"]["Tables"]["fleet_documents"]["Row"],
  | "id"
  | "vehicle_id"
  | "driver_id"
  | "kind"
  | "number"
  | "issued_at"
  | "expires_at"
  | "notes"
  | "attachment_file_id"
  | "created_at"
  | "updated_at"
> & {
  vehicle: { patente: string } | null;
  driver: { full_name: string } | null;
};

function narrow(row: FleetDocumentSelectRow): FleetDocument | null {
  if (!isFleetDocKind(row.kind)) {
    logger.error("fleet_documents.unknown_kind", { kind: row.kind });
    return null;
  }
  return {
    ...row,
    kind: row.kind,
  };
}

const SELECT_COLUMNS =
  "id, vehicle_id, driver_id, kind, number, issued_at, expires_at, notes, attachment_file_id, created_at, updated_at, vehicle:vehicles(patente), driver:drivers(full_name)";

export async function listFleetDocumentsAction(): Promise<
  ActionResult<FleetDocument[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fleet_documents:read")) {
    return { ok: false, error: "No tenés permiso para ver la documentación." };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await paginateRange((from, to) =>
    supabase
      .from("fleet_documents")
      .select(SELECT_COLUMNS)
      .order("expires_at", { ascending: true })
      .order("id")
      .range(from, to),
  );
  if (error) {
    logger.error("fleet_documents.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo listar la documentación." };
  }

  const rows = (data ?? [])
    .map((row) => narrow(row))
    .filter((row): row is FleetDocument => row !== null);
  return { ok: true, data: rows };
}

export async function createFleetDocumentAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fleet_documents:write")) {
    return { ok: false, error: "No tenés permiso para crear documentación." };
  }
  const parsed = FleetDocumentCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createSupabaseClient();
  const fileError = await linkableFileError(
    supabase,
    parsed.data.attachment_file_id,
  );
  if (fileError) return { ok: false, error: fileError };
  const { data, error } = await supabase
    .from("fleet_documents")
    .insert({
      vehicle_id: parsed.data.vehicle_id ?? null,
      driver_id: parsed.data.driver_id ?? null,
      kind: parsed.data.kind,
      number: parsed.data.number ?? null,
      issued_at: parsed.data.issued_at ?? null,
      expires_at: parsed.data.expires_at,
      notes: parsed.data.notes ?? null,
      attachment_file_id: parsed.data.attachment_file_id ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) {
    logger.error("fleet_documents.create.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo crear la documentación." };
  }

  await logAudit(
    "fleet_document.created",
    ctx.userId,
    { kind: parsed.data.kind, expires_at: parsed.data.expires_at },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updateFleetDocumentAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fleet_documents:write")) {
    return { ok: false, error: "No tenés permiso para editar documentación." };
  }
  const parsed = FleetDocumentUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { id, ...rest } = parsed.data;

  const supabase = await createSupabaseClient();
  const fileError = await linkableFileError(supabase, rest.attachment_file_id);
  if (fileError) return { ok: false, error: fileError };
  const { error } = await supabase
    .from("fleet_documents")
    .update({
      ...(rest.vehicle_id !== undefined && { vehicle_id: rest.vehicle_id }),
      ...(rest.driver_id !== undefined && { driver_id: rest.driver_id }),
      ...(rest.kind !== undefined && { kind: rest.kind }),
      ...(rest.number !== undefined && { number: rest.number }),
      ...(rest.issued_at !== undefined && { issued_at: rest.issued_at }),
      ...(rest.expires_at !== undefined && { expires_at: rest.expires_at }),
      ...(rest.notes !== undefined && { notes: rest.notes }),
      ...(rest.attachment_file_id !== undefined && {
        attachment_file_id: rest.attachment_file_id,
      }),
    })
    .eq("id", id);
  if (error) {
    logger.error("fleet_documents.update.failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo actualizar la documentación." };
  }

  await logAudit(
    "fleet_document.updated",
    ctx.userId,
    { fields: Object.keys(rest) as JsonValue[] },
    id,
  );
  return { ok: true, data: undefined };
}

export async function deleteFleetDocumentAction(input: {
  id: string;
}): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fleet_documents:write")) {
    return { ok: false, error: "No tenés permiso para borrar documentación." };
  }
  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("fleet_documents")
    .delete()
    .eq("id", input.id);
  if (error) {
    logger.error("fleet_documents.delete.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo borrar la documentación." };
  }
  await logAudit("fleet_document.deleted", ctx.userId, {}, input.id);
  return { ok: true, data: undefined };
}

/**
 * Uploads the scanned document and points the fleet document at it. The file
 * row goes first (storeUploadedFile); if the document cannot be updated (gone,
 * or hidden by RLS) the file is discarded. A replaced file is left unlinked
 * for the orphan sweep.
 */
export async function uploadFleetDocumentFileAction(
  formData: FormData,
): Promise<ActionResult<{ fileId: string }>> {
  const ctx = await requireUserContext();
  if (
    !userCan(ctx.access, "fleet_documents:write") ||
    !userCan(ctx.access, "files:write")
  ) {
    return { ok: false, error: "No tenés permiso para adjuntar archivos." };
  }
  const parsed = FleetDocumentFileSchema.safeParse({
    documentId: formData.get("documentId"),
  });
  if (!parsed.success) return { ok: false, error: "Documento inválido." };
  const { documentId } = parsed.data;

  const supabase = await createSupabaseClient();
  const stored = await storeUploadedFile(
    supabase,
    ctx.userId,
    formData.get("file"),
  );
  if (!stored.ok) return stored;

  const { data, error } = await supabase
    .from("fleet_documents")
    .update({ attachment_file_id: stored.data.fileId })
    .eq("id", documentId)
    .select("id");
  if (error || !data || data.length === 0) {
    await discardStoredFile(supabase, stored.data);
    logger.error("fleet_documents.attach.failed", {
      userId: ctx.userId,
      documentId,
      error,
    });
    return { ok: false, error: "No se pudo adjuntar el archivo." };
  }

  await logAudit(
    "fleet_document.file_attached",
    ctx.userId,
    { file_id: stored.data.fileId },
    documentId,
  );
  return { ok: true, data: { fileId: stored.data.fileId } };
}
