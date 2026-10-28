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
  MaintenanceCreateSchema,
  MaintenanceUpdateSchema,
  isMaintenanceKind,
  type MaintenanceRecord,
} from "../schema";

type MaintenanceSelectRow = Pick<
  Database["public"]["Tables"]["maintenance_records"]["Row"],
  | "id"
  | "vehicle_id"
  | "service_date"
  | "kind"
  | "description"
  | "cost"
  | "odometer_km"
  | "next_service_date"
  | "next_service_km"
  | "provider"
  | "notes"
  | "created_at"
> & { vehicle: { patente: string } | null };

function narrow(row: MaintenanceSelectRow): MaintenanceRecord | null {
  if (!isMaintenanceKind(row.kind)) {
    logger.error("maintenance.unknown_kind", { kind: row.kind });
    return null;
  }
  return {
    ...row,
    kind: row.kind,
    cost: row.cost === null ? null : Number(row.cost),
    odometer_km: row.odometer_km === null ? null : Number(row.odometer_km),
    next_service_km:
      row.next_service_km === null ? null : Number(row.next_service_km),
  };
}

const SELECT_COLUMNS =
  "id, vehicle_id, service_date, kind, description, cost, odometer_km, next_service_date, next_service_km, provider, notes, created_at, vehicle:vehicles(patente)";

export async function listMaintenanceAction(): Promise<
  ActionResult<MaintenanceRecord[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "maintenance:read")) {
    return { ok: false, error: "No tenés permiso para ver mantenimientos." };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await paginateRange((from, to) =>
    supabase
      .from("maintenance_records")
      .select(SELECT_COLUMNS)
      .order("service_date", { ascending: false })
      .order("id")
      .range(from, to),
  );
  if (error) {
    logger.error("maintenance.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar los mantenimientos." };
  }

  const rows = (data ?? [])
    .map((row) => narrow(row))
    .filter((row): row is MaintenanceRecord => row !== null);
  return { ok: true, data: rows };
}

export async function createMaintenanceAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "maintenance:write")) {
    return { ok: false, error: "No tenés permiso para crear mantenimientos." };
  }
  const parsed = MaintenanceCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("maintenance_records")
    .insert({
      vehicle_id: parsed.data.vehicle_id,
      service_date: parsed.data.service_date,
      kind: parsed.data.kind,
      description: parsed.data.description,
      cost: parsed.data.cost ?? null,
      odometer_km: parsed.data.odometer_km ?? null,
      next_service_date: parsed.data.next_service_date ?? null,
      next_service_km: parsed.data.next_service_km ?? null,
      provider: parsed.data.provider ?? null,
      notes: parsed.data.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) {
    logger.error("maintenance.create.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo crear el mantenimiento." };
  }

  await logAudit(
    "maintenance.created",
    ctx.userId,
    { service_date: parsed.data.service_date },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updateMaintenanceAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "maintenance:write")) {
    return { ok: false, error: "No tenés permiso para editar mantenimientos." };
  }
  const parsed = MaintenanceUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { id, ...rest } = parsed.data;

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("maintenance_records")
    .update({
      ...(rest.vehicle_id !== undefined && { vehicle_id: rest.vehicle_id }),
      ...(rest.service_date !== undefined && {
        service_date: rest.service_date,
      }),
      ...(rest.kind !== undefined && { kind: rest.kind }),
      ...(rest.description !== undefined && { description: rest.description }),
      ...(rest.cost !== undefined && { cost: rest.cost }),
      ...(rest.odometer_km !== undefined && { odometer_km: rest.odometer_km }),
      ...(rest.next_service_date !== undefined && {
        next_service_date: rest.next_service_date,
      }),
      ...(rest.next_service_km !== undefined && {
        next_service_km: rest.next_service_km,
      }),
      ...(rest.provider !== undefined && { provider: rest.provider }),
      ...(rest.notes !== undefined && { notes: rest.notes }),
    })
    .eq("id", id);
  if (error) {
    logger.error("maintenance.update.failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo actualizar el mantenimiento." };
  }

  await logAudit(
    "maintenance.updated",
    ctx.userId,
    { fields: Object.keys(rest) as JsonValue[] },
    id,
  );
  return { ok: true, data: undefined };
}

export async function deleteMaintenanceAction(input: {
  id: string;
}): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "maintenance:write")) {
    return { ok: false, error: "No tenés permiso para borrar mantenimientos." };
  }
  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("maintenance_records")
    .delete()
    .eq("id", input.id);
  if (error) {
    logger.error("maintenance.delete.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo borrar el mantenimiento." };
  }
  await logAudit("maintenance.deleted", ctx.userId, {}, input.id);
  return { ok: true, data: undefined };
}
