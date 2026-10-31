"use server";

import { z } from "zod";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { canManageClosedPeriods } from "../lib/period-close";

type ActionResult<T = void> =
  { ok: true; data: T } | { ok: false; error: string };

const PeriodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Período inválido (YYYY-MM).");

export type ClosedPeriod = {
  period: string;
  closed_at: string;
  note: string | null;
};

export async function listClosedPeriodsAction(): Promise<
  ActionResult<ClosedPeriod[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("accounting_closed_periods")
    .select("period, closed_at, note")
    .order("period", { ascending: false });
  if (error) {
    return { ok: false, error: "No se pudieron leer los períodos cerrados." };
  }
  return { ok: true, data: data ?? [] };
}

export async function closeAccountingPeriodAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!canManageClosedPeriods(ctx.access)) {
    return { ok: false, error: "Solo owner/admin pueden cerrar períodos." };
  }
  const parsed = PeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Inválido." };
  }
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("accounting_closed_periods")
    .insert({ period: parsed.data, closed_by: ctx.userId });
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "El período ya está cerrado." };
    }
    logger.error("period.close.failed", {
      userId: ctx.userId,
      period: parsed.data,
      error,
    });
    return { ok: false, error: "No se pudo cerrar el período." };
  }
  await logAudit("accounting_period.closed", ctx.userId, {
    period: parsed.data,
  });
  return { ok: true, data: undefined };
}

export async function reopenAccountingPeriodAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!canManageClosedPeriods(ctx.access)) {
    return { ok: false, error: "Solo owner/admin pueden reabrir períodos." };
  }
  const parsed = PeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Inválido." };
  }
  const supabase = getServiceClient();
  const { data: reopened, error } = await supabase
    .from("accounting_closed_periods")
    .delete()
    .eq("period", parsed.data)
    .select("period");
  if (error) {
    logger.error("period.reopen.failed", {
      userId: ctx.userId,
      period: parsed.data,
      error,
    });
    return { ok: false, error: "No se pudo reabrir el período." };
  }
  if (reopened.length === 0) {
    return { ok: false, error: "El período no estaba cerrado." };
  }
  await logAudit("accounting_period.reopened", ctx.userId, {
    period: parsed.data,
  });
  return { ok: true, data: undefined };
}
