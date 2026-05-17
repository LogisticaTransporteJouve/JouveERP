"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

import {
  AdjustVacationBalanceSchema,
  CreateLeaveSchema,
  DeleteLeaveSchema,
  GrantVacationBalancesSchema,
  isLeaveKind,
  isVacationBalanceStatus,
  UpdateLeaveSchema,
  type EmployeeLeave,
  type VacationBalance,
} from "../vacation-schema";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [k: string]: JsonValue | undefined }
  | JsonValue[];

async function logAudit(
  eventType: string,
  actorId: string,
  payload: { [k: string]: JsonValue | undefined },
  targetResourceId?: string,
) {
  const service = getServiceClient();
  const { error } = await service.from("audit_events").insert({
    actor_id: actorId,
    event_type: eventType,
    target_resource_id: targetResourceId ?? null,
    payload,
  });
  if (error) {
    logger.error("audit.insert.failed", { eventType, error });
  }
}

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
  if (!userCan(ctx.roles, "hr:read")) {
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
  if (!userCan(ctx.roles, "hr:write")) {
    return { ok: false, error: "Sin permiso." };
  }
  const parsed = CreateLeaveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("employee_leaves")
    .insert({
      employee_id: parsed.data.employee_id,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date,
      kind: parsed.data.kind,
      notes: parsed.data.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "No se pudo crear." };
  }
  await logAudit(
    "leave.created",
    ctx.userId,
    {
      employee_id: parsed.data.employee_id,
      kind: parsed.data.kind,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date,
    },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updateLeaveAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:write")) {
    return { ok: false, error: "Sin permiso." };
  }
  const parsed = UpdateLeaveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const { id, ...rest } = parsed.data;

  type LeaveUpdate =
    Database["public"]["Tables"]["employee_leaves"]["Update"];
  const patch: LeaveUpdate = {};
  if (rest.start_date !== undefined) patch.start_date = rest.start_date;
  if (rest.end_date !== undefined) patch.end_date = rest.end_date;
  if (rest.kind !== undefined) patch.kind = rest.kind;
  if (rest.notes !== undefined) patch.notes = rest.notes ?? null;
  if (Object.keys(patch).length === 0) return { ok: true, data: undefined };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("employee_leaves")
    .update(patch)
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  await logAudit("leave.updated", ctx.userId, { fields: Object.keys(patch) }, id);
  return { ok: true, data: undefined };
}

export async function deleteLeaveAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:write")) {
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
  if (!userCan(ctx.roles, "hr:read")) {
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
      .map((row) => narrowBalance(row as Record<string, unknown> & { status: string }))
      .filter((row): row is VacationBalance => row !== null),
  };
}

export async function grantVacationBalancesAction(
  input: unknown,
): Promise<ActionResult<{ count: number }>> {
  const ctx = await requireUserContext();
  // Otorgar balances es admin-level — afecta a todos los empleados.
  if (!userCan(ctx.roles, "hr:admin")) {
    return { ok: false, error: "Sin permiso." };
  }
  const parsed = GrantVacationBalancesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase.rpc("grant_vacation_balances", {
    p_target_year: parsed.data.target_year,
    p_carryover: parsed.data.carryover,
  });

  if (error) return { ok: false, error: error.message };
  const count = (data ?? []).length;
  await logAudit(
    "vacation.balances_granted",
    ctx.userId,
    {
      target_year: parsed.data.target_year,
      carryover: parsed.data.carryover,
      count,
    },
  );
  return { ok: true, data: { count } };
}

export async function adjustVacationBalanceAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:admin")) {
    return { ok: false, error: "Sin permiso." };
  }
  const parsed = AdjustVacationBalanceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const { id, ...rest } = parsed.data;

  type BalanceUpdate =
    Database["public"]["Tables"]["employee_vacation_balances"]["Update"];
  const patch: BalanceUpdate = {};
  if (rest.bonus_days !== undefined) patch.bonus_days = rest.bonus_days;
  if (rest.status !== undefined) patch.status = rest.status;
  if (rest.notes !== undefined) patch.notes = rest.notes ?? null;
  if (Object.keys(patch).length === 0) return { ok: true, data: undefined };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("employee_vacation_balances")
    .update(patch)
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  await logAudit(
    "vacation.balance_adjusted",
    ctx.userId,
    { fields: Object.keys(patch) },
    id,
  );
  return { ok: true, data: undefined };
}
