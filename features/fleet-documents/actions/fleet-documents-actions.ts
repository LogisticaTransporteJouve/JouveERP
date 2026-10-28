"use server";

import { logAudit } from "@/lib/actions/audit";
import type { JsonValue } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { paginateRange } from "@/lib/supabase/paginate";

import {
  FleetDocumentCreateSchema,
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
  "id, vehicle_id, driver_id, kind, number, issued_at, expires_at, notes, created_at, updated_at, vehicle:vehicles(patente), driver:drivers(full_name)";

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
