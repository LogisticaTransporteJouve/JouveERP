"use server";

import { logAudit } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { paginateRange } from "@/lib/supabase/paginate";

import {
  AddPayrollEntryExtraSchema,
  ClosePayrollPeriodSchema,
  isPayrollStatus,
  RemovePayrollEntryExtraSchema,
  ReopenPayrollPeriodSchema,
  SeedPayrollPeriodSchema,
  UpdatePayrollEntryExtraSchema,
  UpdatePayrollEntrySchema,
  type PayrollEntryExtra,
  type PayrollEntryResolved,
  type PayrollPeriod,
} from "../payroll-schema";

function narrowPeriod(row: {
  status: string;
  [key: string]: unknown;
}): PayrollPeriod | null {
  if (!isPayrollStatus(row.status)) {
    logger.error("payroll.unknown_status", { value: row.status });
    return null;
  }
  return row as PayrollPeriod;
}

const PERIOD_COLS =
  "id, year, month, status, notes, closed_at, closed_by, created_by, created_at, updated_at";

// ─── List & detail ───────────────────────────────────────────────────────────

export async function listPayrollPeriodsAction(): Promise<
  ActionResult<PayrollPeriod[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:read")) {
    return { ok: false, error: "Sin permiso para ver liquidaciones." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await paginateRange((from, to) =>
    supabase
      .from("payroll_periods")
      .select(PERIOD_COLS)
      .order("year", { ascending: false })
      .order("month", { ascending: false })
      .order("id")
      .range(from, to),
  );

  if (error) {
    logger.error("payroll.list_periods.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar los períodos." };
  }
  return {
    ok: true,
    data: (data ?? [])
      .map(narrowPeriod)
      .filter((row): row is PayrollPeriod => row !== null),
  };
}

export async function getPayrollPeriodAction(
  year: number,
  month: number,
): Promise<
  ActionResult<{
    period: PayrollPeriod | null;
    entries: PayrollEntryResolved[];
  }>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:read")) {
    return { ok: false, error: "Sin permiso para ver liquidaciones." };
  }

  const supabase = await createSupabaseClient();
  const { data: periodRow, error: periodErr } = await supabase
    .from("payroll_periods")
    .select(PERIOD_COLS)
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();

  if (periodErr) {
    return { ok: false, error: periodErr.message };
  }

  if (!periodRow) {
    return { ok: true, data: { period: null, entries: [] } };
  }
  const period = narrowPeriod(periodRow);
  if (!period) {
    return { ok: false, error: "Estado de período inválido." };
  }

  const { data: entries, error: entriesErr } = await supabase
    .from("v_payroll_entries_with_payments")
    .select(
      "id, period_id, employee_id, sueldo_neto, extras_total, vacaciones_monto, viaticos, deudas, telefono, total_a_pagar, paid_total, saldo, payments_count, notes",
    )
    .eq("period_id", period.id);

  if (entriesErr) {
    return { ok: false, error: entriesErr.message };
  }

  const employeeIds = (entries ?? [])
    .map((e) => e.employee_id)
    .filter((id): id is string => id !== null);

  const { data: employees, error: empErr } = await supabase
    .from("employees")
    .select("id, legal_name, pay_frequency, is_active")
    .in(
      "id",
      employeeIds.length > 0
        ? employeeIds
        : ["00000000-0000-0000-0000-000000000000"],
    );

  if (empErr) {
    return { ok: false, error: empErr.message };
  }
  const empById = new Map<
    string,
    { legal_name: string; pay_frequency: string; is_active: boolean }
  >(
    (employees ?? []).map((e) => [
      e.id,
      {
        legal_name: e.legal_name,
        pay_frequency: e.pay_frequency,
        is_active: e.is_active,
      },
    ]),
  );

  const resolved: PayrollEntryResolved[] = (entries ?? [])
    .filter((row) => row.id && row.employee_id && row.period_id)
    .map((row) => {
      const emp = empById.get(row.employee_id ?? "");
      return {
        id: row.id ?? "",
        period_id: row.period_id ?? "",
        employee_id: row.employee_id ?? "",
        employee_legal_name: emp?.legal_name ?? "(sin nombre)",
        employee_pay_frequency: emp?.pay_frequency ?? "mensual",
        employee_is_active: emp?.is_active ?? true,
        sueldo_neto: Number(row.sueldo_neto ?? 0),
        extras_total: Number(row.extras_total ?? 0),
        vacaciones_monto: Number(row.vacaciones_monto ?? 0),
        viaticos: Number(row.viaticos ?? 0),
        deudas: Number(row.deudas ?? 0),
        telefono: Number(row.telefono ?? 0),
        total_a_pagar: Number(row.total_a_pagar ?? 0),
        paid_total: Number(row.paid_total ?? 0),
        saldo: Number(row.saldo ?? 0),
        payments_count: Number(row.payments_count ?? 0),
        notes: row.notes ?? null,
      };
    })
    .sort((a, b) =>
      a.employee_legal_name.localeCompare(b.employee_legal_name, "es-AR"),
    );

  return { ok: true, data: { period, entries: resolved } };
}

// ─── Seed (create period + entries) ──────────────────────────────────────────

export async function seedPayrollPeriodAction(
  input: unknown,
): Promise<ActionResult<{ period_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:write")) {
    return { ok: false, error: "Sin permiso para crear períodos." };
  }

  const parsed = SeedPayrollPeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Parámetros inválidos." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase.rpc("seed_payroll_period", {
    p_year: parsed.data.year,
    p_month: parsed.data.month,
  });

  if (error) {
    logger.error("payroll.seed.failed", { userId: ctx.userId, error });
    return { ok: false, error: error.message };
  }
  await logAudit(
    "payroll.period_created",
    ctx.userId,
    { year: parsed.data.year, month: parsed.data.month },
    data ?? undefined,
  );
  return { ok: true, data: { period_id: data ?? "" } };
}

// ─── Close & reopen ──────────────────────────────────────────────────────────

export async function closePayrollPeriodAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:write")) {
    return { ok: false, error: "Sin permiso para cerrar períodos." };
  }
  const parsed = ClosePayrollPeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "ID inválido." };
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("payroll_periods")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      closed_by: ctx.userId,
    })
    .eq("id", parsed.data.id);

  if (error) return { ok: false, error: error.message };
  await logAudit("payroll.period_closed", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}

export async function reopenPayrollPeriodAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  // Reopening requires hr:admin (stricter than close).
  if (!userCan(ctx.roles, "hr:admin")) {
    return { ok: false, error: "Sin permiso para reabrir períodos." };
  }
  const parsed = ReopenPayrollPeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "ID inválido." };
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("payroll_periods")
    .update({
      status: "draft",
      closed_at: null,
      closed_by: null,
    })
    .eq("id", parsed.data.id);

  if (error) return { ok: false, error: error.message };
  await logAudit("payroll.period_reopened", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}

// ─── Update entry ────────────────────────────────────────────────────────────

export async function updatePayrollEntryAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:write")) {
    return { ok: false, error: "Sin permiso para editar la planilla." };
  }
  const parsed = UpdatePayrollEntrySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { id, ...rest } = parsed.data;

  type EntryUpdate = Database["public"]["Tables"]["payroll_entries"]["Update"];
  const patch: EntryUpdate = {};
  if (rest.sueldo_neto !== undefined) patch.sueldo_neto = rest.sueldo_neto;
  if (rest.vacaciones_monto !== undefined)
    patch.vacaciones_monto = rest.vacaciones_monto;
  if (rest.viaticos !== undefined) patch.viaticos = rest.viaticos;
  if (rest.deudas !== undefined) patch.deudas = rest.deudas;
  if (rest.telefono !== undefined) patch.telefono = rest.telefono;
  if (rest.notes !== undefined) patch.notes = rest.notes ?? null;

  if (Object.keys(patch).length === 0) {
    return { ok: true, data: undefined };
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("payroll_entries")
    .update(patch)
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  await logAudit(
    "payroll.entry_updated",
    ctx.userId,
    { fields: Object.keys(patch) },
    id,
  );
  return { ok: true, data: undefined };
}

// ─── Extras ──────────────────────────────────────────────────────────────────

export async function listPayrollEntryExtrasAction(
  entryId: string,
): Promise<ActionResult<PayrollEntryExtra[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:read")) {
    return { ok: false, error: "Sin permiso." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("payroll_entry_extras")
    .select(
      "id, entry_id, amount, description, sort_order, created_by, created_at",
    )
    .eq("entry_id", entryId)
    .order("sort_order");

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as PayrollEntryExtra[] };
}

export async function addPayrollEntryExtraAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:write")) {
    return { ok: false, error: "Sin permiso." };
  }
  const parsed = AddPayrollEntryExtraSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createSupabaseClient();
  // Compute the next sort_order.
  const { data: existing } = await supabase
    .from("payroll_entry_extras")
    .select("sort_order")
    .eq("entry_id", parsed.data.entry_id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (existing?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("payroll_entry_extras")
    .insert({
      entry_id: parsed.data.entry_id,
      amount: parsed.data.amount,
      description: parsed.data.description,
      sort_order: nextOrder,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? "Falló." };
  await logAudit(
    "payroll.extra_added",
    ctx.userId,
    {
      entry_id: parsed.data.entry_id,
      amount: parsed.data.amount,
      description: parsed.data.description,
    },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updatePayrollEntryExtraAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:write")) {
    return { ok: false, error: "Sin permiso." };
  }
  const parsed = UpdatePayrollEntryExtraSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { id, ...rest } = parsed.data;

  type ExtraUpdate =
    Database["public"]["Tables"]["payroll_entry_extras"]["Update"];
  const patch: ExtraUpdate = {};
  if (rest.amount !== undefined) patch.amount = rest.amount;
  if (rest.description !== undefined) patch.description = rest.description;
  if (Object.keys(patch).length === 0) return { ok: true, data: undefined };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("payroll_entry_extras")
    .update(patch)
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  await logAudit(
    "payroll.extra_updated",
    ctx.userId,
    { fields: Object.keys(patch) },
    id,
  );
  return { ok: true, data: undefined };
}

export async function removePayrollEntryExtraAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:write")) {
    return { ok: false, error: "Sin permiso." };
  }
  const parsed = RemovePayrollEntryExtraSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "ID inválido." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("payroll_entry_extras")
    .delete()
    .eq("id", parsed.data.id);

  if (error) return { ok: false, error: error.message };
  await logAudit("payroll.extra_removed", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}
