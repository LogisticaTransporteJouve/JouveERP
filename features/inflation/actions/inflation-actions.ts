"use server";

import type { ActionResult } from "@/lib/query/run-action";
import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { paginateRange } from "@/lib/supabase/paginate";

import {
  InflationAdjustmentCreateSchema,
  InflationAdjustmentDeleteSchema,
  InflationApplySchema,
  InflationRevertSchema,
  type InflationAdjustment,
} from "../schema";

export async function listInflationAdjustmentsAction(): Promise<
  ActionResult<InflationAdjustment[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const supabase = await createClient();
  const { data, error } = await paginateRange((from, to) =>
    supabase
      .from("inflation_adjustments")
      .select(
        "id, period, coefficient, index_source, notes, journal_entry_id, applied_at, applied_by, created_at, updated_at",
      )
      .order("period", { ascending: false })
      .order("id")
      .range(from, to),
  );
  if (error) {
    logger.error("inflation_adjustments.list.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudieron leer." };
  }
  return { ok: true, data: data ?? [] };
}

export async function createInflationAdjustmentAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:write")) {
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
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: "Ya hay un coeficiente para ese período." };
    }
    logger.error("inflation_adjustments.create.failed", {
      userId: ctx.userId,
      period: parsed.data.period,
      error,
    });
    return { ok: false, error: "No se pudo crear." };
  }
  return { ok: true, data: { id: data.id } };
}

export async function deleteInflationAdjustmentAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:write")) {
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
    logger.error("inflation_adjustments.delete.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error,
    });
    return { ok: false, error: "No se pudo borrar." };
  }
  return { ok: true, data: undefined };
}

/** Links the manual reexpression entry to the period's coefficient. */
export async function applyInflationAdjustmentAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:write")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const parsed = InflationApplySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Inválido." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inflation_adjustments")
    .update({
      journal_entry_id: parsed.data.journal_entry_id,
      applied_at: new Date().toISOString(),
      applied_by: ctx.userId,
    })
    .eq("id", parsed.data.id)
    .is("journal_entry_id", null)
    .select("id, period")
    .maybeSingle();
  if (error || !data) {
    logger.error("inflation_adjustments.apply.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error,
    });
    return {
      ok: false,
      error: error
        ? "No se pudo vincular el asiento."
        : "El período ya tiene un asiento aplicado.",
    };
  }

  await logAudit(
    "inflation_adjustment.applied",
    ctx.userId,
    { period: data.period, journal_entry_id: parsed.data.journal_entry_id },
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}

/**
 * Unlinks the entry from the coefficient (does NOT reverse the journal
 * entry — that needs its own reversal entry in the journal).
 */
export async function revertInflationApplicationAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:write")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const parsed = InflationRevertSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Inválido." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inflation_adjustments")
    .update({ journal_entry_id: null, applied_at: null, applied_by: null })
    .eq("id", parsed.data.id)
    .not("journal_entry_id", "is", null)
    .select("id, period")
    .maybeSingle();
  if (error || !data) {
    logger.error("inflation_adjustments.revert.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error,
    });
    return {
      ok: false,
      error: error
        ? "No se pudo desvincular."
        : "El período no tiene asiento aplicado.",
    };
  }

  await logAudit(
    "inflation_adjustment.reverted",
    ctx.userId,
    { period: data.period },
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}
