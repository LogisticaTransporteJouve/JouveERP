"use server";

import { logAudit } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";

import {
  EmployeeDocumentCreateSchema,
  EmployeeDocumentUpdateSchema,
  isEmployeeDocumentKind,
  type EmployeeDocument,
  type ExpiringDocumentRow,
} from "../schema";

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
    .select(
      "id, employee_id, kind, number, issued_at, expires_at, issuing_authority, notes, attachment_file_id, notified_at, created_by, created_at, updated_at",
    )
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
  const { data, error } = await paginateRange((from, to) =>
    supabase
      .from("v_documents_expiring")
      .select(
        "id, employee_id, kind, number, expires_at, notified_at, employee_name, employee_is_active, days_until_expiry",
      )
      .order("days_until_expiry", { ascending: true })
      .order("id")
      .range(from, to),
  );

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
  await logAudit(
    "employee_document.created",
    ctx.userId,
    { employee_id: parsed.data.employee_id, kind: parsed.data.kind },
    data.id,
  );
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

  // We only set the keys that come in — undefined = leave untouched.
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
  // Reset notified_at on any update — if you renew the date, the cron
  // has to be able to alert again.
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
  await logAudit("employee_document.updated", ctx.userId, patch, id);
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
  await logAudit("employee_document.deleted", ctx.userId, {}, id);
  return { ok: true, data: undefined };
}
