"use server";

import { logAudit } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { payrollDbErrorMessage } from "../lib/payroll-payments";
import {
  CreateGarnishmentSchema,
  DeleteGarnishmentSchema,
  isGarnishmentMode,
  UpdateGarnishmentSchema,
  type Garnishment,
  type GarnishmentMode,
} from "../payroll-schema";

// Garnishments (embargos). Writing one refreshes the garnishment of the
// employee's entries in draft periods (trigger employee_garnishments_refresh_entries).

const COLS =
  "id, employee_id, mode, percentage, amount, active_from, active_to, beneficiary, court_note";

type Row = Pick<
  Database["public"]["Tables"]["employee_garnishments"]["Row"],
  | "id"
  | "employee_id"
  | "mode"
  | "percentage"
  | "amount"
  | "active_from"
  | "active_to"
  | "beneficiary"
  | "court_note"
>;

function narrowGarnishment(row: Row): Garnishment | null {
  const { mode } = row;
  if (!isGarnishmentMode(mode)) {
    logger.error("garnishments.unknown_mode", { value: mode });
    return null;
  }
  return {
    ...row,
    mode,
    percentage: row.percentage === null ? null : Number(row.percentage),
    amount: row.amount === null ? null : Number(row.amount),
  };
}

function valueColumns(mode: GarnishmentMode, value: number) {
  return mode === "percentage"
    ? { percentage: value, amount: null }
    : { percentage: null, amount: value };
}

/** Garnishments of one employee, or of every employee without an id. */
export async function listGarnishmentsAction(
  employeeId?: string,
): Promise<ActionResult<Garnishment[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    return { ok: false, error: "Sin permiso para ver embargos." };
  }
  const supabase = await createSupabaseClient();
  let query = supabase
    .from("employee_garnishments")
    .select(COLS)
    .order("active_from", { ascending: false })
    .order("id")
    .limit(500);
  if (employeeId) query = query.eq("employee_id", employeeId);
  const { data, error } = await query;
  if (error) {
    logger.error("garnishments.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron leer los embargos." };
  }
  return {
    ok: true,
    data: (data ?? [])
      .map(narrowGarnishment)
      .filter((g): g is Garnishment => g !== null),
  };
}

export async function createGarnishmentAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso para cargar embargos." };
  }
  const parsed = CreateGarnishmentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const v = parsed.data;
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("employee_garnishments")
    .insert({
      employee_id: v.employee_id,
      mode: v.mode,
      ...valueColumns(v.mode, v.value),
      active_from: v.active_from,
      active_to: v.active_to ?? null,
      beneficiary: v.beneficiary ?? null,
      court_note: v.court_note ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    logger.error("garnishments.create.failed", { userId: ctx.userId, error });
    return {
      ok: false,
      error: payrollDbErrorMessage(error, "No se pudo cargar el embargo."),
    };
  }
  await logAudit(
    "employee.garnishment_created",
    ctx.userId,
    {
      employee_id: v.employee_id,
      mode: v.mode,
      value: v.value,
      active_from: v.active_from,
      active_to: v.active_to ?? null,
    },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updateGarnishmentAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso para editar embargos." };
  }
  const parsed = UpdateGarnishmentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const v = parsed.data;
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("employee_garnishments")
    .update({
      mode: v.mode,
      ...valueColumns(v.mode, v.value),
      active_from: v.active_from,
      active_to: v.active_to ?? null,
      beneficiary: v.beneficiary ?? null,
      court_note: v.court_note ?? null,
    })
    .eq("id", v.id)
    .select("id");
  if (error) {
    logger.error("garnishments.update.failed", { userId: ctx.userId, error });
    return {
      ok: false,
      error: payrollDbErrorMessage(error, "No se pudo editar el embargo."),
    };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "El embargo ya no existe." };
  }
  await logAudit(
    "employee.garnishment_updated",
    ctx.userId,
    {
      mode: v.mode,
      value: v.value,
      active_from: v.active_from,
      active_to: v.active_to ?? null,
    },
    v.id,
  );
  return { ok: true, data: undefined };
}

export async function deleteGarnishmentAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso para borrar embargos." };
  }
  const parsed = DeleteGarnishmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "ID inválido." };
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("employee_garnishments")
    .delete()
    .eq("id", parsed.data.id)
    .select("id");
  if (error) {
    return {
      ok: false,
      error: payrollDbErrorMessage(error, "No se pudo borrar el embargo."),
    };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "No se pudo borrar el embargo." };
  }
  await logAudit(
    "employee.garnishment_deleted",
    ctx.userId,
    {},
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}
