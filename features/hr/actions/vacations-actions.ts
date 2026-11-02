"use server";

import { logAudit } from "@/lib/actions/audit";
import { createLeave } from "@/lib/commands/create-leave";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { todayInAR } from "@/lib/format";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { applyVacationOpening } from "../lib/vacation-opening";
import { currentVacationPeriodYear } from "../lib/vacation-periods";

import {
  CreateLeaveSchema,
  DeleteLeaveSchema,
  isLeaveKind,
  isVacationBalanceStatus,
  SetVacationOpeningSchema,
  type EmployeeLeave,
  type VacationBalance,
  type VacationOverviewRow,
} from "../vacation-schema";

// ─── Leaves ──────────────────────────────────────────────────────────────────

const LEAVE_COLS =
  "id, employee_id, start_date, end_date, days, kind, notes, created_by, created_at, updated_at";

function narrowLeave(row: {
  kind: string;
  [key: string]: unknown;
}): EmployeeLeave | null {
  if (!isLeaveKind(row.kind)) {
    logger.error("leaves.unknown_kind", { value: row.kind });
    return null;
  }
  return row as EmployeeLeave;
}

export async function listEmployeeLeavesAction(
  employeeId: string,
): Promise<ActionResult<EmployeeLeave[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    return { ok: false, error: "Sin permiso para ver licencias." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("employee_leaves")
    .select(LEAVE_COLS)
    .eq("employee_id", employeeId)
    .order("start_date", { ascending: false });

  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    data: (data ?? [])
      .map(narrowLeave)
      .filter((row): row is EmployeeLeave => row !== null),
  };
}

export async function createLeaveAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso." };
  }
  const parsed = CreateLeaveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  return createLeave(ctx.userId, parsed.data);
}

export async function deleteLeaveAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso." };
  }
  const parsed = DeleteLeaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "ID inválido." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("employee_leaves")
    .delete()
    .eq("id", parsed.data.id);

  if (error) return { ok: false, error: error.message };
  await logAudit("leave.deleted", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}

// ─── Vacation balances ───────────────────────────────────────────────────────

function narrowBalance(row: {
  status: string;
  [key: string]: unknown;
}): VacationBalance | null {
  if (!isVacationBalanceStatus(row.status)) {
    logger.error("balances.unknown_status", { value: row.status });
    return null;
  }
  return row as VacationBalance;
}

export async function listVacationBalancesAction(
  employeeId: string,
): Promise<ActionResult<VacationBalance[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    return { ok: false, error: "Sin permiso." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("v_employee_vacation_balances")
    .select(
      "id, employee_id, period_year, entitled_days, bonus_days, carryover_days, used_days, remaining_days, granted_at, expires_at, status, notes, created_at, updated_at",
    )
    .eq("employee_id", employeeId)
    .order("period_year", { ascending: false });

  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    data: (data ?? [])
      .filter((row) => row.id && row.employee_id && row.period_year !== null)
      .map((row) =>
        narrowBalance(row as Record<string, unknown> & { status: string }),
      )
      .filter((row): row is VacationBalance => row !== null),
  };
}

// ─── Opening balance + overview ─────────────────────────────────────────────

/** Loads by hand the vacation days of the period in course and the days
 *  pending from earlier years. Owner/admin, like the balances' RLS. */
export async function setVacationOpeningAction(
  input: unknown,
): Promise<ActionResult<{ period_year: number }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:admin")) {
    return {
      ok: false,
      error:
        "Solo el dueño o un administrador pueden cargar saldos de vacaciones.",
    };
  }
  const parsed = SetVacationOpeningSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createSupabaseClient();
  const result = await applyVacationOpening(supabase, {
    employeeId: parsed.data.employee_id,
    currentDays: parsed.data.current_days,
    previousDays: parsed.data.previous_days,
    today: todayInAR(),
    userId: ctx.userId,
  });
  if (!result.ok) {
    logger.warn("vacations.opening.failed", {
      userId: ctx.userId,
      employeeId: parsed.data.employee_id,
    });
    return { ok: false, error: result.error };
  }

  await logAudit(
    "employee.vacation_balance_set",
    ctx.userId,
    {
      period_year: result.periodYear,
      current_days: parsed.data.current_days,
      previous_days: parsed.data.previous_days,
    },
    parsed.data.employee_id,
  );
  return { ok: true, data: { period_year: result.periodYear } };
}

/** Personal → Vacaciones: one row per active employee for the period in
 *  course, plus what is still pending from earlier periods kept open. */
export async function listVacationOverviewAction(): Promise<
  ActionResult<{ period_year: number; rows: VacationOverviewRow[] }>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    return { ok: false, error: "Sin permiso." };
  }
  const periodYear = currentVacationPeriodYear(todayInAR());
  const supabase = await createSupabaseClient();

  const [employeesRes, balancesRes] = await Promise.all([
    supabase
      .from("employees")
      .select("id, legal_name, hire_date")
      .eq("is_active", true)
      .order("legal_name"),
    supabase
      .from("v_employee_vacation_balances")
      .select(
        "employee_id, period_year, entitled_days, bonus_days, carryover_days, used_days, remaining_days, expires_at, status",
      )
      .lte("period_year", periodYear)
      .in("status", ["active", "extended"]),
  ]);
  if (employeesRes.error || balancesRes.error) {
    logger.error("vacations.overview.failed", {
      userId: ctx.userId,
      error: employeesRes.error ?? balancesRes.error,
    });
    return { ok: false, error: "No se pudieron cargar las vacaciones." };
  }

  const byEmployee = new Map<string, typeof balancesRes.data>();
  for (const b of balancesRes.data ?? []) {
    if (!b.employee_id) continue;
    const list = byEmployee.get(b.employee_id) ?? [];
    list.push(b);
    byEmployee.set(b.employee_id, list);
  }

  const rows: VacationOverviewRow[] = (employeesRes.data ?? []).map((e) => {
    const own = byEmployee.get(e.id) ?? [];
    const current = own.find((b) => b.period_year === periodYear);
    const previous = own.filter(
      (b) => b.period_year !== null && b.period_year < periodYear,
    );
    const previousDays = previous.reduce(
      (sum, b) => sum + Math.max(b.remaining_days ?? 0, 0),
      0,
    );
    const currentRemaining = current?.remaining_days ?? 0;
    return {
      employee_id: e.id,
      legal_name: e.legal_name,
      hire_date: e.hire_date,
      period_year: periodYear,
      current_days: current
        ? (current.entitled_days ?? 0) + (current.bonus_days ?? 0)
        : null,
      carryover_days: current?.carryover_days ?? 0,
      previous_days: previousDays,
      used_days: current?.used_days ?? 0,
      remaining_days: currentRemaining + previousDays,
      expires_at: current?.expires_at ?? null,
    };
  });

  return { ok: true, data: { period_year: periodYear, rows } };
}
