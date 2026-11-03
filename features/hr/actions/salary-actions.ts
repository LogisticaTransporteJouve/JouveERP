"use server";

import { logAudit } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { ApplySalaryRaiseSchema, type SalaryChange } from "../account-schema";

// Aumentos en % (roadmap 3.6). The raise and its history are written by the
// database (apply_salary_raise + the employees trigger); a hand edit of the
// base salary also leaves a history row.

export async function listSalaryChangesAction(
  employeeId: string,
): Promise<ActionResult<SalaryChange[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    return { ok: false, error: "Sin permiso para ver el historial de sueldo." };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("employee_salary_changes")
    .select(
      "id, effective_month, previous_salary, new_salary, raise_percentage, reason, created_at",
    )
    .eq("employee_id", employeeId)
    .order("effective_month", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    logger.error("salary_changes.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo leer el historial de sueldo." };
  }
  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      ...row,
      previous_salary:
        row.previous_salary === null ? null : Number(row.previous_salary),
      new_salary: row.new_salary === null ? null : Number(row.new_salary),
      raise_percentage:
        row.raise_percentage === null ? null : Number(row.raise_percentage),
    })),
  };
}

export async function applySalaryRaiseAction(
  input: unknown,
): Promise<ActionResult<{ updated: number }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso para aplicar aumentos." };
  }
  const parsed = ApplySalaryRaiseSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const v = parsed.data;
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase.rpc("apply_salary_raise", {
    p_employee_ids: v.employee_ids,
    p_percentage: v.percentage,
    p_effective_month: v.effective_month,
    ...(v.reason ? { p_reason: v.reason } : {}),
  });
  if (error) {
    if (!error.hint) {
      logger.error("salary_raise.failed", { userId: ctx.userId, error });
    }
    return {
      ok: false,
      error:
        mapDbGuardError(error, {
          slug: "salary_raise.rejected",
          userId: ctx.userId,
        }) ?? "No se pudo aplicar el aumento.",
    };
  }
  const updated = Number(data ?? 0);
  await logAudit("employee.salary_raise_applied", ctx.userId, {
    employee_ids: v.employee_ids,
    percentage: v.percentage,
    effective_month: v.effective_month,
    reason: v.reason ?? null,
    updated,
  });
  return { ok: true, data: { updated } };
}
