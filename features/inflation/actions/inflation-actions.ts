"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

import {
  InflationAdjustmentCreateSchema,
  InflationAdjustmentDeleteSchema,
  type InflationAdjustment,
} from "../schema";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const UNIQUE_VIOLATION = "23505";

export async function listInflationAdjustmentsAction(): Promise<
  ActionResult<InflationAdjustment[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:read")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inflation_adjustments")
    .select("*")
    .order("period", { ascending: false });
  if (error) {
    logger.error("inflation_adjustments.list.failed", { error });
    return { ok: false, error: "No se pudieron leer." };
  }
  return { ok: true, data: data ?? [] };
}

export async function createInflationAdjustmentAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:write")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const parsed = InflationAdjustmentCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Inválido." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inflation_adjustments")
    .insert({
      period: parsed.data.period,
      coefficient: parsed.data.coefficient,
      index_source: parsed.data.index_source ?? null,
      notes: parsed.data.notes ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { ok: false, error: "Ya hay un coeficiente para ese período." };
    }
    logger.error("inflation_adjustments.create.failed", { error });
    return { ok: false, error: "No se pudo crear." };
  }
  return { ok: true, data: { id: data.id } };
}

export async function deleteInflationAdjustmentAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:write")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const parsed = InflationAdjustmentDeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Inválido." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("inflation_adjustments")
    .delete()
    .eq("id", parsed.data.id);
  if (error) {
    logger.error("inflation_adjustments.delete.failed", { error });
    return { ok: false, error: "No se pudo borrar." };
  }
  return { ok: true, data: undefined };
}
