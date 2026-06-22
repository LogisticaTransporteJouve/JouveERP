"use server";

import type { ActionResult } from "@/lib/query/run-action";
import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

import {
  CostCenterCreateSchema,
  CostCenterDeleteSchema,
  CostCenterUpdateSchema,
  type CostCenter,
} from "../schema";

export async function listCostCentersAction(
  options: { onlyActive?: boolean } = {},
): Promise<ActionResult<CostCenter[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:read")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const supabase = await createClient();
  const query = supabase.from("cost_centers").select("*").order("code");
  if (options.onlyActive) query.eq("is_active", true);
  const { data, error } = await query;
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
  if (!userCan(ctx.roles, "accounting:write")) {
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
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION)
      return { ok: false, error: "Ya existe un centro con ese código." };
    logger.error("cost_centers.create.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo crear." };
  }
  await logAudit(
    "cost_center.created",
    ctx.userId,
    { code: parsed.data.code, name: parsed.data.name },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updateCostCenterAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:write")) {
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
  };
  if (Object.keys(update).length === 0) return { ok: true, data: undefined };
  const supabase = await createClient();
  const { error } = await supabase
    .from("cost_centers")
    .update(update)
    .eq("id", id);
  if (error) {
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
  if (!userCan(ctx.roles, "accounting:write")) {
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
    logger.error("cost_centers.delete.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo borrar (¿en uso?)." };
  }
  await logAudit("cost_center.deleted", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}
