"use server";

import { logAudit } from "@/lib/actions/audit";
import { createLeave } from "@/lib/commands/create-leave";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import {
  CreateLeaveSchema,
  DeleteLeaveSchema,
  isLeaveKind,
  isVacationBalanceStatus,
  type EmployeeLeave,
  type VacationBalance,
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
