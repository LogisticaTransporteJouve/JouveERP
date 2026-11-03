"use server";

import { logAudit } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { finalSettlement } from "../lib/final-settlement";
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
  sac_amount: number;
};

async function loadSuggestion(
  supabase: Supabase,
  employeeId: string,
): Promise<
  { ok: true; data: FinalSettlementSuggestion } | { ok: false; error: string }
> {
  const { data: employee, error: empErr } = await supabase
    .from("employees")
    .select("id, hire_date, termination_date, base_salary")
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

  const [periodRes, balancesRes, sacRes] = await Promise.all([
    supabase
      .from("payroll_periods")
      .select("id, status")
      .eq("year", year)
      .eq("month", month)
      .eq("kind", "monthly")
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
  ]);
  if (periodRes.error || balancesRes.error || sacRes.error) {
    logger.error("payroll.final_settlement.read_failed", {
      employeeId,
      error: periodRes.error ?? balancesRes.error ?? sacRes.error,
    });
    return { ok: false, error: "No se pudo calcular la liquidación final." };
  }

  let entrySalary: number | null = null;
  if (periodRes.data) {
    const { data: entry, error } = await supabase
      .from("payroll_entries")
      .select("sueldo_neto")
      .eq("period_id", periodRes.data.id)
      .eq("employee_id", employeeId)
      .maybeSingle();
    if (error) {
      return { ok: false, error: "No se pudo leer la planilla del mes." };
    }
    entrySalary = entry ? Number(entry.sueldo_neto) : null;
  }

  const balances = balancesRes.data ?? [];
  const pending = balances
    .filter((b) => b.status === "active" || b.status === "extended")
    .reduce((sum, b) => sum + Number(b.remaining_days ?? 0), 0);
  const monthlySalary =
    employee.base_salary !== null
      ? Number(employee.base_salary)
      : (entrySalary ?? 0);
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
      sac_amount: Number(sacRes.data ?? 0),
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

  const { data: periodId, error: seedErr } = await supabase.rpc(
    "seed_payroll_period",
    { p_year: year, p_month: month },
  );
  if (seedErr || !periodId) {
    return {
      ok: false,
      error: seedErr?.message ?? `No se pudo abrir la planilla de ${label}.`,
    };
  }

  const { data: entry, error: entryErr } = await supabase
    .from("payroll_entries")
    .upsert(
      {
        period_id: periodId,
        employee_id: v.employee_id,
        sueldo_neto: v.prorated_salary,
        vacaciones_monto: v.vacation_amount,
      },
      { onConflict: "period_id,employee_id" },
    )
    .select("id")
    .single();
  if (entryErr || !entry) {
    logger.error("payroll.final_settlement.entry_failed", {
      userId: ctx.userId,
      error: entryErr,
    });
    return {
      ok: false,
      error: entryErr?.message ?? "No se pudo cargar la liquidación final.",
    };
  }

  const { error: delErr } = await supabase
    .from("payroll_entry_extras")
    .delete()
    .eq("entry_id", entry.id)
    .like("description", `${EXTRA_PREFIX}%`);
  if (delErr) {
    return { ok: false, error: "No se pudieron reemplazar los extras." };
  }
  if (v.sac_amount > 0) {
    const { error: extraErr } = await supabase
      .from("payroll_entry_extras")
      .insert({
        entry_id: entry.id,
        amount: v.sac_amount,
        description: `${EXTRA_PREFIX} SAC proporcional (${formatPayrollPeriod(year, sacMonth(sac_half), "sac")})`,
        sort_order: 900,
        created_by: ctx.userId,
      });
    if (extraErr) {
      return { ok: false, error: "No se pudo cargar el SAC proporcional." };
    }
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
    entry.id,
  );
  return { ok: true, data: { year, month } };
}
