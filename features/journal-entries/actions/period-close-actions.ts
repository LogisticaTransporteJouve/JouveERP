"use server";

import { z } from "zod";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { captureException } from "@/lib/observability";
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
  /** Authorized comprobantes of this period waiting for their entry. */
  pending_entries: number;
};

export async function listClosedPeriodsAction(): Promise<
  ActionResult<ClosedPeriod[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const supabase = getServiceClient();
  const [periodsRes, pendingRes] = await Promise.all([
    supabase
      .from("accounting_closed_periods")
      .select("period, closed_at, note")
      .order("period", { ascending: false }),
    supabase.from("pending_journal_entries").select("accrual_period"),
  ]);
  if (periodsRes.error) {
    return { ok: false, error: "No se pudieron leer los períodos cerrados." };
  }
  // The pending list is informative: a failed read shows no counts.
  if (pendingRes.error) {
    logger.warn("period.pending_entries_read_failed", {
      userId: ctx.userId,
      code: pendingRes.error.code,
    });
  }
  const pendingByPeriod = new Map<string, number>();
  for (const row of pendingRes.data ?? []) {
    pendingByPeriod.set(
      row.accrual_period,
      (pendingByPeriod.get(row.accrual_period) ?? 0) + 1,
    );
  }
  return {
    ok: true,
    data: (periodsRes.data ?? []).map((p) => ({
      ...p,
      pending_entries: pendingByPeriod.get(p.period) ?? 0,
    })),
  };
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
): Promise<ActionResult<{ posted: number }>> {
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
  // Comprobantes AFIP authorized while the period was closed get their entry
  // now. The period is reopened either way; what fails stays pending.
  let posted = 0;
  const { data: repost, error: repostError } = await supabase.rpc(
    "post_pending_journals",
    { p_period: parsed.data },
  );
  if (repostError) {
    captureException(repostError, {
      op: "period.reopen.repost_failed",
      userId: ctx.userId,
      period: parsed.data,
    });
  } else {
    posted = postedCount(repost);
  }
  await logAudit("accounting_period.reopened", ctx.userId, {
    period: parsed.data,
    posted_entries: posted,
  });
  return { ok: true, data: { posted } };
}

function postedCount(result: unknown): number {
  if (typeof result !== "object" || result === null || !("posted" in result)) {
    return 0;
  }
  const posted = Number(result.posted);
  return Number.isFinite(posted) ? posted : 0;
}
