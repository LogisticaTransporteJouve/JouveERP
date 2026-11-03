"use server";

import type { ActionResult } from "@/lib/query/run-action";
import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import {
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
} from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import {
  CostCenterCreateSchema,
  CostCenterDeleteSchema,
  CostCenterUpdateSchema,
  type CostCenter,
  type CostCenterVehicle,
} from "../schema";

function uniqueViolationMessage(message: string): string {
  return message.includes("cost_centers_vehicle_unique")
    ? "Ese camión ya está vinculado a otro centro de costo."
    : "Ya existe un centro con ese código.";
}

/**
 * The trucks a center can be linked to, for whoever reads the centers.
 * vehicles is RLS-limited to operations; this reads id and patente only,
 * through the service client after the gate.
 */
export async function listCostCenterVehiclesAction(): Promise<
  ActionResult<CostCenterVehicle[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const { data, error } = await paginateRange<CostCenterVehicle>((from, to) =>
    getServiceClient()
      .from("vehicles")
      .select("id, patente, alias, is_active")
      .order("patente")
      .order("id")
      .range(from, to),
  );
  if (error) {
    logger.error("cost_centers.vehicles.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron leer los camiones." };
  }
  return { ok: true, data };
}

export async function listCostCentersAction(
  options: { onlyActive?: boolean } = {},
): Promise<ActionResult<CostCenter[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const supabase = await createClient();
  const { data, error } = await paginateRange((from, to) => {
    let query = supabase
      .from("cost_centers")
      .select(
        "id, code, name, description, is_active, created_at, updated_at, vehicle_id",
      )
      .order("code");
    if (options.onlyActive) query = query.eq("is_active", true);
    return query.order("id").range(from, to);
  });
  if (error) {
    logger.error("cost_centers.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron leer los centros." };
  }
  return { ok: true, data: data ?? [] };
}

export async function createCostCenterAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:write")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const parsed = CostCenterCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Inválido." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cost_centers")
    .insert({
      code: parsed.data.code,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      is_active: parsed.data.is_active,
      vehicle_id: parsed.data.vehicle_id ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION)
      return { ok: false, error: uniqueViolationMessage(error.message) };
    logger.error("cost_centers.create.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo crear." };
  }
  await logAudit(
    "cost_center.created",
    ctx.userId,
    {
      code: parsed.data.code,
      name: parsed.data.name,
      vehicle_id: parsed.data.vehicle_id ?? null,
    },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updateCostCenterAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:write")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const parsed = CostCenterUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Inválido." };
  }
  const { id, ...rest } = parsed.data;
  const update = {
    ...(rest.name !== undefined && { name: rest.name }),
    ...(rest.description !== undefined && { description: rest.description }),
    ...(rest.is_active !== undefined && { is_active: rest.is_active }),
    ...(rest.vehicle_id !== undefined && { vehicle_id: rest.vehicle_id }),
  };
  if (Object.keys(update).length === 0) return { ok: true, data: undefined };
  const supabase = await createClient();
  const { error } = await supabase
    .from("cost_centers")
    .update(update)
    .eq("id", id);
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: uniqueViolationMessage(error.message) };
    }
    logger.error("cost_centers.update.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo actualizar." };
  }
  await logAudit("cost_center.updated", ctx.userId, update, id);
  return { ok: true, data: undefined };
}

export async function deleteCostCenterAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:write")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const parsed = CostCenterDeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Inválido." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("cost_centers")
    .delete()
    .eq("id", parsed.data.id);
  if (error) {
    if (error.code === PG_FOREIGN_KEY_VIOLATION) {
      return {
        ok: false,
        error:
          "El centro de costo está en uso en comprobantes, movimientos o asientos. Desactivalo en lugar de borrarlo.",
      };
    }
    logger.error("cost_centers.delete.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo borrar (¿en uso?)." };
  }
  await logAudit("cost_center.deleted", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}
