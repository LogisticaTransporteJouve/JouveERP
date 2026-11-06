"use server";

import { logAudit } from "@/lib/actions/audit";
import { createLeave } from "@/lib/commands/create-leave";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { todayInAR } from "@/lib/format";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import {
  leaveDays,
  leaveDaysInRange,
  pendingVacationDays,
} from "../lib/leaves";
import { currentVacationPeriodYear } from "../lib/vacation-periods";

import {
  CreateLeaveSchema,
  DeleteLeaveSchema,
  HolidayRangeSchema,
  isLeaveKind,
  isVacationBalanceStatus,
  LEAVE_KIND_LABEL,
  LEAVES_BY_RANGE_CAP,
  LeavesByRangeInputSchema,
  SetVacationOpeningSchema,
  type EmployeeLeave,
  type LeaveInRange,
  type LeavesByRange,
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

  if (error) {
    logger.error("leaves.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron cargar las licencias." };
  }
  return {
    ok: true,
    data: (data ?? [])
      .map(narrowLeave)
      .filter((row): row is EmployeeLeave => row !== null),
  };
}

/** Every leave that overlaps [from, to] (optionally one employee or one
 *  kind), with the days that fall inside the range. Gated on hr:read like the
 *  employee's leaves. */
export async function listLeavesByRangeAction(
  input: unknown,
): Promise<ActionResult<LeavesByRange>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    return { ok: false, error: "Sin permiso para ver licencias." };
  }
  const parsed = LeavesByRangeInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { from, to, employeeId, kind } = parsed.data;

  const supabase = await createSupabaseClient();
  let query = supabase
    .from("employee_leaves")
    .select(
      "id, employee_id, start_date, end_date, kind, employees(legal_name)",
    )
    .lte("start_date", to)
    .gte("end_date", from);
  if (employeeId) query = query.eq("employee_id", employeeId);
  if (kind) query = query.eq("kind", kind);
  const { data, error } = await query
    .order("start_date")
    .order("id")
    .limit(LEAVES_BY_RANGE_CAP + 1);

  if (error) {
    logger.error("leaves.range.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron cargar las licencias." };
  }
  const rows = (data ?? []).flatMap((row): LeaveInRange[] => {
    if (!isLeaveKind(row.kind)) {
      logger.error("leaves.unknown_kind", { value: row.kind });
      return [];
    }
    return [
      {
        id: row.id,
        employee_id: row.employee_id,
        employee: row.employees?.legal_name ?? "(sin nombre)",
        kind: row.kind,
        kind_label: LEAVE_KIND_LABEL[row.kind],
        start_date: row.start_date,
        end_date: row.end_date,
        days: leaveDays(row.start_date, row.end_date),
        days_in_range: leaveDaysInRange(row, from, to),
      },
    ];
  });
  return {
    ok: true,
    data: {
      rows: rows.slice(0, LEAVES_BY_RANGE_CAP),
      partial: (data ?? []).length > LEAVES_BY_RANGE_CAP,
    },
  };
}

/** Holiday dates in [from, to], for the vacation start-date warning. */
export async function listHolidayDatesAction(
  from: string,
  to: string,
): Promise<ActionResult<string[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    return { ok: false, error: "Sin permiso." };
  }
  const range = HolidayRangeSchema.safeParse({ from, to });
  if (!range.success) return { ok: false, error: "Fechas inválidas." };

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("holidays")
    .select("date")
    .gte("date", range.data.from)
    .lte("date", range.data.to)
    .order("date");
  if (error) {
    logger.error("holidays.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron cargar los feriados." };
  }
  return { ok: true, data: (data ?? []).map((h) => h.date) };
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
  const { data, error } = await supabase
    .from("employee_leaves")
    .delete()
    .eq("id", parsed.data.id)
    .select("id");

  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "leaves.delete.rejected",
      userId: ctx.userId,
      id: parsed.data.id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("leaves.delete.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error,
    });
    return { ok: false, error: "No se pudo borrar la licencia." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "La licencia no existe o ya se borró." };
  }
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

  if (error) {
    logger.error("balances.list.failed", { userId: ctx.userId, error });
    return {
      ok: false,
      error: "No se pudieron cargar los saldos de vacaciones.",
    };
  }
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

  // Both periods in one transaction: a refused one leaves neither written.
  const supabase = await createSupabaseClient();
  const { data: periodYear, error } = await supabase.rpc(
    "set_vacation_opening",
    {
      p_employee_id: parsed.data.employee_id,
      p_current_days: parsed.data.current_days ?? undefined,
      p_previous_days: parsed.data.previous_days ?? undefined,
      p_today: todayInAR(),
    },
  );
  if (error || periodYear === null) {
    const guardError = mapDbGuardError(error, {
      slug: "vacations.opening.rejected",
      userId: ctx.userId,
      id: parsed.data.employee_id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("vacations.opening.failed", {
      userId: ctx.userId,
      employeeId: parsed.data.employee_id,
      error,
    });
    return { ok: false, error: "No se pudo guardar el saldo de vacaciones." };
  }

  await logAudit(
    "employee.vacation_balance_set",
    ctx.userId,
    {
      period_year: periodYear,
      current_days: parsed.data.current_days,
      previous_days: parsed.data.previous_days,
    },
    parsed.data.employee_id,
  );
  return { ok: true, data: { period_year: periodYear } };
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
      remaining_days: pendingVacationDays(own, periodYear) ?? 0,
      expires_at: current?.expires_at ?? null,
    };
  });

  return { ok: true, data: { period_year: periodYear, rows } };
}
