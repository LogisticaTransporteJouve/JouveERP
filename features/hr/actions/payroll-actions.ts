"use server";

import { logAudit } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { dbErrorMessage, mapDbGuardError } from "@/lib/db/guard-errors";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { paginateRange } from "@/lib/supabase/paginate";

import {
  AddMissingPayrollEntriesSchema,
  AddPayrollEntryExtraSchema,
  ClosePayrollPeriodSchema,
  isPayrollPeriodKind,
  isPayrollStatus,
  RemovePayrollEntryExtraSchema,
  ReopenPayrollPeriodSchema,
  ResetPayrollOverrideSchema,
  SeedPayrollPeriodSchema,
  SeedSacPeriodSchema,
  UpdatePayrollEntrySchema,
  type PayrollEntryExtra,
  type PayrollEntryResolved,
  type PayrollPeriod,
  type PayrollPeriodKind,
} from "../payroll-schema";
import { isPayMode, type PayMode } from "../schema";

type PeriodRow = Omit<
  Database["public"]["Tables"]["payroll_periods"]["Row"],
  "posts_employee_accounts" | "posts_receipt_gap"
>;

function narrowPeriod(row: PeriodRow): PayrollPeriod | null {
  const { status, kind } = row;
  if (!isPayrollStatus(status)) {
    logger.error("payroll.unknown_status", { value: status });
    return null;
  }
  if (!isPayrollPeriodKind(kind)) {
    logger.error("payroll.unknown_period_kind", { value: kind });
    return null;
  }
  return { ...row, status, kind };
}

const PERIOD_COLS =
  "id, year, month, kind, status, notes, closed_at, closed_by, created_by, created_at, updated_at";

// ─── List & detail ───────────────────────────────────────────────────────────

export async function listPayrollPeriodsAction(): Promise<
  ActionResult<PayrollPeriod[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    return { ok: false, error: "Sin permiso para ver liquidaciones." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await paginateRange((from, to) =>
    supabase
      .from("payroll_periods")
      .select(PERIOD_COLS)
      .order("year", { ascending: false })
      .order("month", { ascending: false })
      .order("kind", { ascending: false })
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
  kind: PayrollPeriodKind = "monthly",
): Promise<
  ActionResult<{
    period: PayrollPeriod | null;
    entries: PayrollEntryResolved[];
  }>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    return { ok: false, error: "Sin permiso para ver liquidaciones." };
  }

  const supabase = await createSupabaseClient();
  const { data: periodRow, error: periodErr } = await supabase
    .from("payroll_periods")
    .select(PERIOD_COLS)
    .eq("year", year)
    .eq("month", month)
    .eq("kind", kind)
    .maybeSingle();

  if (periodErr) {
    return {
      ok: false,
      error: dbErrorMessage(
        periodErr,
        { slug: "payroll.period.read_failed", userId: ctx.userId },
        "No se pudo cargar la planilla.",
      ),
    };
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
      "id, period_id, employee_id, sueldo_neto, extras_total, viaticos, deudas, telefono, embargo, recibo_neto, total_a_pagar, paid_total, paid_transferencia, paid_efectivo, saldo, payments_count, notes, fiscal_share, paid_fiscal, paid_internal, paid_in_kind",
    )
    .eq("period_id", period.id);

  if (entriesErr) {
    return {
      ok: false,
      error: dbErrorMessage(
        entriesErr,
        { slug: "payroll.entries.read_failed", userId: ctx.userId },
        "No se pudo cargar la planilla.",
      ),
    };
  }

  const employeeIds = (entries ?? [])
    .map((e) => e.employee_id)
    .filter((id): id is string => id !== null);

  // The views predate the override flags; read them from the table.
  const { data: overrides, error: overridesErr } = await supabase
    .from("payroll_entries")
    .select("id, deudas_override, embargo_override")
    .eq("period_id", period.id);
  if (overridesErr) {
    return {
      ok: false,
      error: dbErrorMessage(
        overridesErr,
        { slug: "payroll.overrides.read_failed", userId: ctx.userId },
        "No se pudo cargar la planilla.",
      ),
    };
  }
  const overrideById = new Map((overrides ?? []).map((o) => [o.id, o]));

  const { data: employees, error: empErr } = await supabase
    .from("employees")
    .select("id, legal_name, pay_frequency, pay_mode, is_active")
    .in(
      "id",
      employeeIds.length > 0
        ? employeeIds
        : ["00000000-0000-0000-0000-000000000000"],
    );

  if (empErr) {
    return {
      ok: false,
      error: dbErrorMessage(
        empErr,
        { slug: "payroll.employees.read_failed", userId: ctx.userId },
        "No se pudo cargar la planilla.",
      ),
    };
  }
  const empById = new Map<
    string,
    {
      legal_name: string;
      pay_frequency: string;
      pay_mode: PayMode;
      is_active: boolean;
    }
  >(
    (employees ?? []).map((e) => [
      e.id,
      {
        legal_name: e.legal_name,
        pay_frequency: e.pay_frequency,
        pay_mode: isPayMode(e.pay_mode) ? e.pay_mode : "acordado",
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
        employee_pay_mode: emp?.pay_mode ?? "acordado",
        employee_is_active: emp?.is_active ?? true,
        sueldo_neto: Number(row.sueldo_neto ?? 0),
        extras_total: Number(row.extras_total ?? 0),
        viaticos: Number(row.viaticos ?? 0),
        deudas: Number(row.deudas ?? 0),
        deudas_override:
          overrideById.get(row.id ?? "")?.deudas_override ?? false,
        telefono: Number(row.telefono ?? 0),
        embargo: Number(row.embargo ?? 0),
        embargo_override:
          overrideById.get(row.id ?? "")?.embargo_override ?? false,
        recibo_neto: row.recibo_neto === null ? null : Number(row.recibo_neto),
        total_a_pagar: Number(row.total_a_pagar ?? 0),
        paid_total: Number(row.paid_total ?? 0),
        paid_transferencia: Number(row.paid_transferencia ?? 0),
        paid_efectivo: Number(row.paid_efectivo ?? 0),
        saldo: Number(row.saldo ?? 0),
        payments_count: Number(row.payments_count ?? 0),
        fiscal_share: Number(row.fiscal_share ?? 0),
        paid_fiscal: Number(row.paid_fiscal ?? 0),
        paid_internal: Number(row.paid_internal ?? 0),
        paid_in_kind: Number(row.paid_in_kind ?? 0),
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
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso para crear períodos." };
  }

  const parsed = SeedPayrollPeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Parámetros inválidos." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .rpc("create_payroll_period", {
      p_year: parsed.data.year,
      p_month: parsed.data.month,
    })
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      error: dbErrorMessage(
        error,
        { slug: "payroll.seed.failed", userId: ctx.userId },
        "No se pudo crear la planilla.",
      ),
    };
  }
  // An existing planilla is opened as is: only a new one is audited.
  if (data.created) {
    await logAudit(
      "payroll.period_created",
      ctx.userId,
      { year: parsed.data.year, month: parsed.data.month },
      data.period_id,
    );
  }
  return { ok: true, data: { period_id: data.period_id } };
}

export async function seedSacPeriodAction(
  input: unknown,
): Promise<ActionResult<{ period_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso para crear períodos." };
  }

  const parsed = SeedSacPeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Parámetros inválidos." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .rpc("create_sac_period", {
      p_year: parsed.data.year,
      p_half: parsed.data.half,
    })
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      error: dbErrorMessage(
        error,
        { slug: "payroll.seed_sac.failed", userId: ctx.userId },
        "No se pudo crear el SAC.",
      ),
    };
  }
  if (data.created) {
    await logAudit(
      "payroll.sac_period_created",
      ctx.userId,
      { year: parsed.data.year, half: parsed.data.half },
      data.period_id,
    );
  }
  return { ok: true, data: { period_id: data.period_id } };
}

export async function addMissingPayrollEntriesAction(
  input: unknown,
): Promise<ActionResult<{ added: number }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso para modificar liquidaciones." };
  }
  const parsed = AddMissingPayrollEntriesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Período inválido." };

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase.rpc("fill_payroll_period", {
    p_period_id: parsed.data.period_id,
  });

  if (error) {
    return {
      ok: false,
      error: dbErrorMessage(
        error,
        { slug: "payroll.fill.failed", userId: ctx.userId },
        "No se pudieron agregar los empleados.",
      ),
    };
  }
  const added = Number(data ?? 0);
  if (added > 0) {
    await logAudit(
      "payroll.entries_added",
      ctx.userId,
      { added },
      parsed.data.period_id,
    );
  }
  return { ok: true, data: { added } };
}

// ─── Close & reopen ──────────────────────────────────────────────────────────

export async function closePayrollPeriodAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso para cerrar períodos." };
  }
  const parsed = ClosePayrollPeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "ID inválido." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("payroll_periods")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      closed_by: ctx.userId,
    })
    .eq("id", parsed.data.id)
    .eq("status", "draft")
    .select("id");

  if (error) {
    if (!error.hint) {
      logger.error("payroll.close.failed", { userId: ctx.userId, error });
    }
    return {
      ok: false,
      error:
        mapDbGuardError(error, {
          slug: "payroll.close.rejected",
          userId: ctx.userId,
          id: parsed.data.id,
        }) ?? "No se pudo cerrar el período.",
    };
  }
  if (!data?.length) {
    return { ok: false, error: "El período ya estaba cerrado o no existe." };
  }
  await logAudit("payroll.period_closed", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}

export async function reopenPayrollPeriodAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  // Reopening requires hr:admin (stricter than close).
  if (!userCan(ctx.access, "hr:admin")) {
    return { ok: false, error: "Sin permiso para reabrir períodos." };
  }
  const parsed = ReopenPayrollPeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "ID inválido." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("payroll_periods")
    .update({
      status: "draft",
      closed_at: null,
      closed_by: null,
    })
    .eq("id", parsed.data.id)
    .eq("status", "closed")
    .select("id");

  if (error) {
    if (!error.hint) {
      logger.error("payroll.reopen.failed", { userId: ctx.userId, error });
    }
    return {
      ok: false,
      error:
        mapDbGuardError(error, {
          slug: "payroll.reopen.rejected",
          userId: ctx.userId,
          id: parsed.data.id,
        }) ?? "No se pudo reabrir el período.",
    };
  }
  if (!data?.length) {
    return {
      ok: false,
      error: "El período ya estaba en borrador o no existe.",
    };
  }
  await logAudit("payroll.period_reopened", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}

// ─── Update entry ────────────────────────────────────────────────────────────

export async function updatePayrollEntryAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
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
  if (rest.viaticos !== undefined) patch.viaticos = rest.viaticos;
  if (rest.deudas !== undefined) patch.deudas = rest.deudas;
  if (rest.telefono !== undefined) patch.telefono = rest.telefono;
  if (rest.embargo !== undefined) patch.embargo = rest.embargo;
  if (rest.recibo_neto !== undefined) patch.recibo_neto = rest.recibo_neto;
  if (rest.notes !== undefined) patch.notes = rest.notes ?? null;

  const supabase = await createSupabaseClient();

  if (Object.keys(patch).length === 0) {
    return { ok: true, data: undefined };
  }

  const { data, error } = await supabase
    .from("payroll_entries")
    .update(patch)
    .eq("id", id)
    .select("id");

  if (error) {
    return {
      ok: false,
      error: dbErrorMessage(
        error,
        { slug: "payroll.entry_update.failed", userId: ctx.userId, id: id },
        "No se pudo guardar la fila.",
      ),
    };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "La fila ya no existe." };
  }
  await logAudit(
    "payroll.entry_updated",
    ctx.userId,
    { fields: Object.keys(patch) },
    id,
  );
  return { ok: true, data: undefined };
}

/** Back to the computed figure after a hand edit: Deudas from the plans'
 *  installments, Embargo from the employee's garnishments. */
export async function resetPayrollOverrideAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso para editar la planilla." };
  }
  const parsed = ResetPayrollOverrideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { id, field } = parsed.data;

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("payroll_entries")
    .update(
      field === "deudas"
        ? { deudas_override: false }
        : { embargo_override: false },
    )
    .eq("id", id)
    .select("id");
  if (error) {
    return {
      ok: false,
      error: dbErrorMessage(
        error,
        { slug: "payroll.entry_reset.failed", userId: ctx.userId, id: id },
        "No se pudo guardar la fila.",
      ),
    };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "La fila ya no existe." };
  }
  await logAudit(
    field === "deudas"
      ? "payroll.entry_deudas_reset"
      : "payroll.entry_embargo_reset",
    ctx.userId,
    {},
    id,
  );
  return { ok: true, data: undefined };
}

// ─── Extras ──────────────────────────────────────────────────────────────────

export async function listPayrollEntryExtrasAction(
  entryId: string,
): Promise<ActionResult<PayrollEntryExtra[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    return { ok: false, error: "Sin permiso." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("payroll_entry_extras")
    .select(
      "id, entry_id, amount, description, sort_order, created_by, created_at, loan_installment_id",
    )
    .eq("entry_id", entryId)
    .order("sort_order");

  if (error) {
    return {
      ok: false,
      error: dbErrorMessage(
        error,
        { slug: "payroll.extras.read_failed", userId: ctx.userId },
        "No se pudieron cargar los extras.",
      ),
    };
  }
  return { ok: true, data: (data ?? []) as PayrollEntryExtra[] };
}

export async function addPayrollEntryExtraAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
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

  if (error || !data) {
    return {
      ok: false,
      error: dbErrorMessage(
        error,
        { slug: "payroll.extra_add.failed", userId: ctx.userId },
        "No se pudo agregar el extra.",
      ),
    };
  }
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

export async function removePayrollEntryExtraAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso." };
  }
  const parsed = RemovePayrollEntryExtraSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "ID inválido." };

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("payroll_entry_extras")
    .delete()
    .eq("id", parsed.data.id)
    .select("id");

  if (error) {
    return {
      ok: false,
      error: dbErrorMessage(
        error,
        {
          slug: "payroll.extra_remove.failed",
          userId: ctx.userId,
          id: parsed.data.id,
        },
        "No se pudo eliminar el extra.",
      ),
    };
  }
  // A delete that matches no row (already gone, or blocked) must not report
  // success: the extra would keep adding to the total to pay.
  if (!data || data.length === 0) {
    return { ok: false, error: "No se pudo eliminar el extra." };
  }
  await logAudit("payroll.extra_removed", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}
