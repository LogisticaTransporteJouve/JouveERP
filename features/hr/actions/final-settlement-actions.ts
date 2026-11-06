"use server";

import { logAudit } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { finalSettlement, sacStillOwed } from "../lib/final-settlement";
import {
  ApplyFinalSettlementSchema,
  formatPayrollPeriod,
  sacHalfOfMonth,
  sacMonth,
  type SacHalf,
} from "../payroll-schema";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/** Extras this flow writes start with it, so applying again replaces them. */
const EXTRA_PREFIX = "Liquidación final:";

export type FinalSettlementSuggestion = {
  employee_id: string;
  termination_date: string;
  year: number;
  month: number;
  /** null while the month's planilla does not exist (applying creates it). */
  period_status: "draft" | "closed" | null;
  monthly_salary: number;
  days_worked: number;
  prorated_salary: number;
  vacation_days: number;
  vacation_amount: number;
  sac_half: SacHalf;
  /** What the half's SAC planilla already pays this employee (0 without
   *  one): the suggested sac_amount is net of it. */
  sac_in_sac_planilla: number;
  sac_amount: number;
};

async function previousMonthSalary(
  supabase: Supabase,
  employeeId: string,
  year: number,
  month: number,
): Promise<{ ok: true; data: number | null } | { ok: false; error: string }> {
  const { data: period, error: periodErr } = await supabase
    .from("payroll_periods")
    .select("id")
    .eq("year", year)
    .eq("month", month)
    .eq("kind", "monthly")
    .maybeSingle();
  if (periodErr) {
    return { ok: false, error: "No se pudo leer la planilla anterior." };
  }
  if (!period) return { ok: true, data: null };
  const { data: entry, error } = await supabase
    .from("payroll_entries")
    .select("sueldo_neto")
    .eq("period_id", period.id)
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (error) {
    return { ok: false, error: "No se pudo leer la planilla anterior." };
  }
  return { ok: true, data: entry ? Number(entry.sueldo_neto) : null };
}

async function loadSuggestion(
  supabase: Supabase,
  employeeId: string,
): Promise<
  { ok: true; data: FinalSettlementSuggestion } | { ok: false; error: string }
> {
  const { data: employee, error: empErr } = await supabase
    .from("employees")
    .select("id, hire_date, termination_date")
    .eq("id", employeeId)
    .maybeSingle();
  if (empErr) return { ok: false, error: "No se pudo leer el empleado." };
  if (!employee) return { ok: false, error: "El empleado no existe." };
  const termination = employee.termination_date;
  if (!termination) {
    return { ok: false, error: "El empleado no tiene fecha de baja." };
  }
  const year = Number(termination.slice(0, 4));
  const month = Number(termination.slice(5, 7));
  const half = sacHalfOfMonth(month);

  const [periodRes, sacPeriodRes, balancesRes, sacRes, salaryRes] =
    await Promise.all([
      supabase
        .from("payroll_periods")
        .select("id, status")
        .eq("year", year)
        .eq("month", month)
        .eq("kind", "monthly")
        .maybeSingle(),
      supabase
        .from("payroll_periods")
        .select("id")
        .eq("year", year)
        .eq("month", sacMonth(half))
        .eq("kind", "sac")
        .maybeSingle(),
      supabase
        .from("v_employee_vacation_balances")
        .select("period_year, remaining_days, status")
        .eq("employee_id", employeeId),
      supabase.rpc("payroll_sac_suggestion", {
        p_employee_id: employeeId,
        p_year: year,
        p_half: half,
      }),
      supabase.rpc("employee_salary_for_month", {
        p_employee_id: employeeId,
        p_month: `${termination.slice(0, 7)}-01`,
      }),
    ]);
  const readError =
    periodRes.error ??
    sacPeriodRes.error ??
    balancesRes.error ??
    sacRes.error ??
    salaryRes.error;
  if (readError) {
    logger.error("payroll.final_settlement.read_failed", {
      employeeId,
      error: readError,
    });
    return { ok: false, error: "No se pudo calcular la liquidación final." };
  }

  // Without a base salary for the month, the previous month's planilla line:
  // the leaving month's own line is what applying overwrites, so reading it
  // would prorate the prorated salary again on every reload.
  let monthlySalary = salaryRes.data === null ? null : Number(salaryRes.data);
  if (monthlySalary === null) {
    const previous = await previousMonthSalary(
      supabase,
      employeeId,
      month === 1 ? year - 1 : year,
      month === 1 ? 12 : month - 1,
    );
    if (!previous.ok) return previous;
    monthlySalary = previous.data ?? 0;
  }

  // The half's SAC planilla, filled while the employee was still active,
  // already pays him a SAC: the final settlement adds only the rest.
  let sacInSacPlanilla = 0;
  if (sacPeriodRes.data) {
    const { data: sacEntry, error } = await supabase
      .from("v_payroll_entries_resolved")
      .select("sueldo_neto, extras_total")
      .eq("period_id", sacPeriodRes.data.id)
      .eq("employee_id", employeeId)
      .maybeSingle();
    if (error) {
      return { ok: false, error: "No se pudo leer la planilla del SAC." };
    }
    sacInSacPlanilla = sacEntry
      ? Number(sacEntry.sueldo_neto ?? 0) + Number(sacEntry.extras_total ?? 0)
      : 0;
  }

  const balances = balancesRes.data ?? [];
  const pending = balances
    .filter((b) => b.status === "active" || b.status === "extended")
    .reduce((sum, b) => sum + Number(b.remaining_days ?? 0), 0);
  const settlement = finalSettlement({
    terminationDate: termination,
    hireDate: employee.hire_date,
    monthlySalary,
    pendingVacationDays: pending,
    hasBalanceForTerminationYear: balances.some((b) => b.period_year === year),
  });
  const periodStatus = periodRes.data?.status;

  return {
    ok: true,
    data: {
      employee_id: employeeId,
      termination_date: termination,
      year,
      month,
      period_status:
        periodStatus === "draft" || periodStatus === "closed"
          ? periodStatus
          : null,
      monthly_salary: monthlySalary,
      days_worked: settlement.daysWorked,
      prorated_salary: settlement.proratedSalary,
      vacation_days: settlement.vacationDays,
      vacation_amount: settlement.vacationAmount,
      sac_half: half,
      sac_in_sac_planilla: sacInSacPlanilla,
      sac_amount: sacStillOwed(Number(sacRes.data ?? 0), sacInSacPlanilla),
    },
  };
}

export async function getFinalSettlementAction(
  employeeId: string,
): Promise<ActionResult<FinalSettlementSuggestion>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    return { ok: false, error: "Sin permiso para ver liquidaciones." };
  }
  const supabase = await createSupabaseClient();
  return loadSuggestion(supabase, employeeId);
}

/**
 * Writes the final settlement into the planilla of the leaving month:
 * salary for the days worked, unused vacation pay, and the proportional
 * SAC as an extra. Creates the month's planilla (and the employee's line)
 * when missing; applying again replaces the earlier figures.
 */
export async function applyFinalSettlementAction(
  input: unknown,
): Promise<ActionResult<{ year: number; month: number }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso para editar la planilla." };
  }
  const parsed = ApplyFinalSettlementSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const v = parsed.data;
  const supabase = await createSupabaseClient();
  const base = await loadSuggestion(supabase, v.employee_id);
  if (!base.ok) return base;
  const { year, month, sac_half } = base.data;
  const label = formatPayrollPeriod(year, month);
  if (base.data.period_status === "closed") {
    return {
      ok: false,
      error: `La planilla de ${label} está cerrada: reabrila para cargar la liquidación final.`,
    };
  }

  // One transaction: the planilla (created when missing), the employee's line
  // and its settlement extras are written together or not at all.
  const { data: entryId, error } = await supabase.rpc(
    "apply_final_settlement",
    {
      p_employee_id: v.employee_id,
      p_year: year,
      p_month: month,
      p_sueldo_neto: v.prorated_salary,
      p_vacaciones_monto: v.vacation_amount,
      p_extra_prefix: EXTRA_PREFIX,
      p_sac_amount: v.sac_amount,
      p_sac_description: `${EXTRA_PREFIX} SAC proporcional (${formatPayrollPeriod(year, sacMonth(sac_half), "sac")})`,
    },
  );
  if (error || !entryId) {
    const guardError = mapDbGuardError(error, {
      slug: "payroll.final_settlement.rejected",
      userId: ctx.userId,
      id: v.employee_id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("payroll.final_settlement.failed", {
      userId: ctx.userId,
      employeeId: v.employee_id,
      error,
    });
    return { ok: false, error: "No se pudo cargar la liquidación final." };
  }

  await logAudit(
    "payroll.final_settlement_applied",
    ctx.userId,
    {
      employee_id: v.employee_id,
      year,
      month,
      prorated_salary: v.prorated_salary,
      vacation_days: v.vacation_days,
      vacation_amount: v.vacation_amount,
      sac_amount: v.sac_amount,
    },
    entryId,
  );
  return { ok: true, data: { year, month } };
}
