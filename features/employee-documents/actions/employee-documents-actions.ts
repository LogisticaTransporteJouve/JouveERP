"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

import {
  EmployeeDocumentCreateSchema,
  EmployeeDocumentUpdateSchema,
  isEmployeeDocumentKind,
  type EmployeeDocument,
  type ExpiringDocumentRow,
} from "../schema";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function narrowDocument(row: {
  kind: string;
  [k: string]: unknown;
}): EmployeeDocument | null {
  if (!isEmployeeDocumentKind(row.kind)) {
    logger.error("employee_documents.unknown_kind", { value: row.kind });
    return null;
  }
  return row as EmployeeDocument;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listEmployeeDocumentsAction(
  employeeId: string,
): Promise<ActionResult<EmployeeDocument[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:read")) {
    return { ok: false, error: "Sin permiso para ver documentos." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_documents")
    .select("*")
    .eq("employee_id", employeeId)
    .order("expires_at", { ascending: true })
    .order("id", { ascending: false });

  if (error) {
    logger.error("employee_documents.list.failed", {
      userId: ctx.userId,
      employeeId,
      error,
    });
    return { ok: false, error: "No se pudieron listar los documentos." };
  }

  const items = (data ?? [])
    .map((row) => narrowDocument(row))
    .filter((d): d is EmployeeDocument => d !== null);

  return { ok: true, data: items };
}

export async function listExpiringDocumentsAction(): Promise<
  ActionResult<ExpiringDocumentRow[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:read")) {
    return { ok: false, error: "Sin permiso para ver documentos." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_documents_expiring")
    .select("*")
    .order("days_until_expiry", { ascending: true });

  if (error) {
    logger.error("employee_documents.expiring.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudieron leer los vencimientos." };
  }
  return { ok: true, data: (data ?? []) as ExpiringDocumentRow[] };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createEmployeeDocumentAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:write")) {
    return { ok: false, error: "Sin permiso para cargar documentos." };
  }
  const parsed = EmployeeDocumentCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_documents")
    .insert({
      employee_id: parsed.data.employee_id,
      kind: parsed.data.kind,
      number: parsed.data.number ?? null,
      issued_at: parsed.data.issued_at ?? null,
      expires_at: parsed.data.expires_at,
      issuing_authority: parsed.data.issuing_authority ?? null,
      notes: parsed.data.notes ?? null,
      attachment_file_id: parsed.data.attachment_file_id ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    logger.error("employee_documents.create.failed", {
      userId: ctx.userId,
      employeeId: parsed.data.employee_id,
      kind: parsed.data.kind,
      error,
    });
    return {
      ok: false,
      error: error?.message ?? "No se pudo crear el documento.",
    };
  }
  return { ok: true, data: { id: data.id } };
}

export async function updateEmployeeDocumentAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:write")) {
    return { ok: false, error: "Sin permiso para editar documentos." };
  }
  const parsed = EmployeeDocumentUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { id, ...rest } = parsed.data;

  // Solo seteamos las keys que vienen — undefined = no tocar.
  type DocUpdate = Database["public"]["Tables"]["employee_documents"]["Update"];
  const patch: DocUpdate = {};
  if (rest.kind !== undefined) patch.kind = rest.kind;
  if (rest.number !== undefined) patch.number = rest.number ?? null;
  if (rest.issued_at !== undefined) patch.issued_at = rest.issued_at ?? null;
  if (rest.expires_at !== undefined) patch.expires_at = rest.expires_at;
  if (rest.issuing_authority !== undefined)
    patch.issuing_authority = rest.issuing_authority ?? null;
  if (rest.notes !== undefined) patch.notes = rest.notes ?? null;
  if (rest.attachment_file_id !== undefined)
    patch.attachment_file_id = rest.attachment_file_id ?? null;
  // Reset notified_at en cualquier update — si renovás la fecha, el cron
  // tiene que poder volver a alertar.
  patch.notified_at = null;
  if (Object.keys(patch).length === 1) return { ok: true, data: undefined };

  const supabase = await createClient();
  const { error } = await supabase
    .from("employee_documents")
    .update(patch)
    .eq("id", id);

  if (error) {
    logger.error("employee_documents.update.failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo actualizar el documento." };
  }
  return { ok: true, data: undefined };
}

export async function deleteEmployeeDocumentAction(
  id: string,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:write")) {
    return { ok: false, error: "Sin permiso para borrar documentos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("employee_documents")
    .delete()
    .eq("id", id);

  if (error) {
    logger.error("employee_documents.delete.failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo borrar el documento." };
  }
  return { ok: true, data: undefined };
}
