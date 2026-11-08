"use server";

import { logAudit } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan, userCanAll } from "@/lib/auth/permissions";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import {
  createEmployeeAccountMovement,
  recordEmployeeAccountCash,
} from "@/lib/commands/record-employee-account";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/paginate";

import {
  CreateDebtPlanSchema,
  CreateManualMovementSchema,
  DeleteAccountMovementSchema,
  DeleteDebtPlanSchema,
  isAccountCurrency,
  isAccountMovementKind,
  isCreditor,
  isPlanStatus,
  RecordAccountCashSchema,
  SetDebtPlanStatusSchema,
  UpdateAccountMovementSchema,
  UpdateDebtPlanSchema,
  type AccountBalance,
  type AccountMovement,
  type DebtPlan,
} from "../account-schema";
import {
  HR_CASH_DENIED_REASON,
  HR_CASH_PERMISSIONS,
  movementMovesCash,
} from "../lib/hr-cash";

// Cuenta corriente del empleado (D1). Balances, plan progress and the
// planilla discount are computed in the database; every write here is a
// plain row or one of its RPCs (record_employee_account_cash,
// delete_employee_account_movement), and the guards there refuse touching a
// movement another document owns.

const MOVEMENTS_LIMIT = 500;

export type EmployeeAccount = {
  balances: AccountBalance[];
  movements: AccountMovement[];
  plans: DebtPlan[];
  /** True when more movements exist than the ones listed. */
  movements_partial: boolean;
};

type DbError = { message: string; code?: string | null; hint?: string | null };

function writeError(
  error: DbError | null,
  slug: string,
  userId: string,
  fallback: string,
): string {
  return mapDbGuardError(error, { slug, userId }) ?? fallback;
}

export async function getEmployeeAccountAction(
  employeeId: string,
): Promise<ActionResult<EmployeeAccount>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    return { ok: false, error: "Sin permiso para ver la cuenta corriente." };
  }
  const supabase = await createSupabaseClient();
  const [balancesRes, movementsRes, plansRes] = await Promise.all([
    supabase
      .from("v_employee_account_balances")
      .select("currency, balance, balance_socio, movements")
      .eq("employee_id", employeeId),
    supabase
      .from("employee_account_movements")
      .select(
        "id, employee_id, kind, currency, amount, movement_date, description, creditor, plan_id, transaction_id, purchase_invoice_id, payroll_entry_id, driver_settlement_id, plan:employee_debt_plans ( description )",
      )
      .eq("employee_id", employeeId)
      .order("movement_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id")
      .limit(MOVEMENTS_LIMIT + 1),
    supabase
      .from("v_employee_debt_plans")
      .select(
        "id, employee_id, description, currency, total, installment_amount, start_month, status, creditor, creditor_name, notes, paid, remaining",
      )
      .eq("employee_id", employeeId)
      .order("start_month", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);
  const error = balancesRes.error ?? movementsRes.error ?? plansRes.error;
  if (error) {
    logger.error("employee_account.read.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo leer la cuenta corriente." };
  }

  const balances: AccountBalance[] = [];
  for (const row of balancesRes.data ?? []) {
    if (!isAccountCurrency(row.currency)) continue;
    balances.push({
      currency: row.currency,
      balance: Number(row.balance ?? 0),
      balance_socio: Number(row.balance_socio ?? 0),
      movements: Number(row.movements ?? 0),
    });
  }

  const rows = movementsRes.data ?? [];
  // A card statement's advance is undone from the statement, not here.
  const cardRes = await fetchInChunks(
    rows.flatMap((r) => (r.transaction_id ? [r.transaction_id] : [])),
    (ids) =>
      supabase
        .from("card_statement_lines")
        .select("transaction_id")
        .in("transaction_id", ids),
    50,
  );
  if (cardRes.error) {
    logger.error("employee_account.card_read_failed", {
      userId: ctx.userId,
      error: cardRes.error,
    });
    return { ok: false, error: "No se pudo leer la cuenta corriente." };
  }
  const fromCard = new Set(cardRes.data.map((r) => r.transaction_id));
  const movements: AccountMovement[] = [];
  for (const row of rows.slice(0, MOVEMENTS_LIMIT)) {
    const { kind, currency, creditor } = row;
    if (
      !isAccountMovementKind(kind) ||
      !isAccountCurrency(currency) ||
      !isCreditor(creditor)
    ) {
      logger.error("employee_account.unknown_movement_value", {
        id: row.id,
        kind,
        currency,
        creditor,
      });
      continue;
    }
    movements.push({
      id: row.id,
      employee_id: row.employee_id,
      kind,
      currency,
      amount: Number(row.amount),
      movement_date: row.movement_date,
      description: row.description,
      creditor,
      plan_id: row.plan_id,
      plan_description: row.plan?.description ?? null,
      transaction_id: row.transaction_id,
      purchase_invoice_id: row.purchase_invoice_id,
      payroll_entry_id: row.payroll_entry_id,
      driver_settlement_id: row.driver_settlement_id,
      card_statement:
        row.transaction_id !== null && fromCard.has(row.transaction_id),
    });
  }

  const plans: DebtPlan[] = [];
  for (const row of plansRes.data ?? []) {
    const { status, currency, creditor } = row;
    if (
      !row.id ||
      !row.employee_id ||
      !isPlanStatus(status) ||
      !isAccountCurrency(currency) ||
      !isCreditor(creditor)
    ) {
      continue;
    }
    plans.push({
      id: row.id,
      employee_id: row.employee_id,
      description: row.description ?? "",
      currency,
      total: Number(row.total ?? 0),
      installment_amount: Number(row.installment_amount ?? 0),
      start_month: row.start_month ?? "",
      status,
      creditor,
      creditor_name: row.creditor_name,
      notes: row.notes,
      paid: Number(row.paid ?? 0),
      remaining: Number(row.remaining ?? 0),
    });
  }

  return {
    ok: true,
    data: {
      balances,
      movements,
      plans,
      movements_partial: rows.length > MOVEMENTS_LIMIT,
    },
  };
}

export type EmployeeAccountBalanceRow = AccountBalance & {
  employee_id: string;
  employee_name: string;
};

/** Every employee with a non-zero balance, for the assistant. */
export async function listEmployeeAccountBalancesAction(): Promise<
  ActionResult<EmployeeAccountBalanceRow[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    return { ok: false, error: "Sin permiso para ver la cuenta corriente." };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("v_employee_account_balances")
    .select("employee_id, currency, balance, balance_socio, movements")
    .neq("balance", 0)
    .order("balance", { ascending: false })
    .limit(500);
  if (error) {
    logger.error("employee_account.balances.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudieron leer los saldos." };
  }
  const ids = [
    ...new Set(
      (data ?? [])
        .map((r) => r.employee_id)
        .filter((id): id is string => id !== null),
    ),
  ];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: employees, error: empErr } = await supabase
      .from("employees")
      .select("id, legal_name")
      .in("id", ids);
    if (empErr) {
      return { ok: false, error: "No se pudieron leer los empleados." };
    }
    for (const e of employees ?? []) names.set(e.id, e.legal_name);
  }
  const rows: EmployeeAccountBalanceRow[] = [];
  for (const row of data ?? []) {
    if (!row.employee_id || !isAccountCurrency(row.currency)) continue;
    rows.push({
      employee_id: row.employee_id,
      employee_name: names.get(row.employee_id) ?? "(sin nombre)",
      currency: row.currency,
      balance: Number(row.balance ?? 0),
      balance_socio: Number(row.balance_socio ?? 0),
      movements: Number(row.movements ?? 0),
    });
  }
  return { ok: true, data: rows };
}

// ─── Movements ───────────────────────────────────────────────────────────────

export async function createManualMovementAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso para cargar movimientos." };
  }
  const parsed = CreateManualMovementSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  return createEmployeeAccountMovement(ctx.userId, parsed.data);
}

/** "Adelanto a empleado" / "Pago del empleado": the treasury movement and the
 *  account movement in one RPC. Moving money also needs transactions:write. */
export async function recordEmployeeAccountCashAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, HR_CASH_PERMISSIONS)) {
    return {
      ok: false,
      error: "Sin permiso para registrar adelantos o pagos de empleados.",
    };
  }
  const parsed = RecordAccountCashSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  return recordEmployeeAccountCash(ctx.userId, parsed.data);
}

export async function updateAccountMovementAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso para editar movimientos." };
  }
  const parsed = UpdateAccountMovementSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("employee_account_movements")
    .update({ description: parsed.data.description })
    .eq("id", parsed.data.id)
    .select("id");
  if (error) {
    return {
      ok: false,
      error: writeError(
        error,
        "employee_account.update.rejected",
        ctx.userId,
        "No se pudo editar el movimiento.",
      ),
    };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "El movimiento ya no existe." };
  }
  await logAudit(
    "employee.account_movement_updated",
    ctx.userId,
    { description: parsed.data.description },
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}

export async function deleteAccountMovementAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso para borrar movimientos." };
  }
  const parsed = DeleteAccountMovementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "ID inválido." };
  const supabase = await createSupabaseClient();
  // Deleting a movement with a Caja movement deletes that one too: it also
  // needs transactions:write.
  const { data: movement, error: readError } = await supabase
    .from("employee_account_movements")
    .select("id, transaction_id")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (readError) {
    logger.error("employee_account.delete.read_failed", {
      userId: ctx.userId,
      error: readError,
    });
    return { ok: false, error: "No se pudo borrar el movimiento." };
  }
  if (!movement) return { ok: false, error: "El movimiento no existe." };
  if (
    movementMovesCash(movement) &&
    !userCanAll(ctx.access, HR_CASH_PERMISSIONS)
  ) {
    return {
      ok: false,
      error: `Sin permiso para borrar este movimiento. ${HR_CASH_DENIED_REASON}`,
    };
  }
  const { error } = await supabase.rpc("delete_employee_account_movement", {
    p_movement_id: parsed.data.id,
  });
  if (error) {
    if (!error.hint) {
      logger.error("employee_account.delete.failed", {
        userId: ctx.userId,
        error,
      });
    }
    return {
      ok: false,
      error: writeError(
        error,
        "employee_account.delete.rejected",
        ctx.userId,
        "No se pudo borrar el movimiento.",
      ),
    };
  }
  await logAudit(
    "employee.account_movement_deleted",
    ctx.userId,
    {},
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}

// ─── Plans ───────────────────────────────────────────────────────────────────

export async function createDebtPlanAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso para cargar planes." };
  }
  const parsed = CreateDebtPlanSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const v = parsed.data;
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("employee_debt_plans")
    .insert({
      employee_id: v.employee_id,
      description: v.description,
      currency: v.currency,
      total: v.total,
      installment_amount: v.installment_amount,
      start_month: v.start_month,
      creditor: v.creditor,
      creditor_name: v.creditor === "socio" ? (v.creditor_name ?? null) : null,
      notes: v.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    logger.error("employee_plans.create.failed", { userId: ctx.userId, error });
    return {
      ok: false,
      error: writeError(
        error,
        "employee_plans.create.rejected",
        ctx.userId,
        "No se pudo cargar el plan.",
      ),
    };
  }
  await logAudit(
    "employee.debt_plan_created",
    ctx.userId,
    {
      employee_id: v.employee_id,
      currency: v.currency,
      total: v.total,
      installment_amount: v.installment_amount,
      start_month: v.start_month,
      creditor: v.creditor,
    },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updateDebtPlanAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso para editar planes." };
  }
  const parsed = UpdateDebtPlanSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const v = parsed.data;
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("employee_debt_plans")
    .update({
      description: v.description,
      total: v.total,
      installment_amount: v.installment_amount,
      start_month: v.start_month,
      creditor: v.creditor,
      creditor_name: v.creditor === "socio" ? (v.creditor_name ?? null) : null,
      notes: v.notes ?? null,
    })
    .eq("id", v.id)
    .select("id");
  if (error) {
    return {
      ok: false,
      error: writeError(
        error,
        "employee_plans.update.rejected",
        ctx.userId,
        "No se pudo editar el plan.",
      ),
    };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "El plan ya no existe." };
  }
  await logAudit(
    "employee.debt_plan_updated",
    ctx.userId,
    {
      total: v.total,
      installment_amount: v.installment_amount,
      start_month: v.start_month,
      creditor: v.creditor,
    },
    v.id,
  );
  return { ok: true, data: undefined };
}

/** Pausar, reactivar, cancelar o condonar. Condonar writes the forgiveness of
 *  what remains (trigger) and cannot be undone. */
export async function setDebtPlanStatusAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso para cambiar planes." };
  }
  const parsed = SetDebtPlanStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("employee_debt_plans")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.id)
    .select("id");
  if (error) {
    return {
      ok: false,
      error: writeError(
        error,
        "employee_plans.status.rejected",
        ctx.userId,
        "No se pudo cambiar el estado del plan.",
      ),
    };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "El plan ya no existe." };
  }
  await logAudit(
    "employee.debt_plan_status_changed",
    ctx.userId,
    { status: parsed.data.status },
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}

export async function deleteDebtPlanAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso para borrar planes." };
  }
  const parsed = DeleteDebtPlanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "ID inválido." };
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("employee_debt_plans")
    .delete()
    .eq("id", parsed.data.id)
    .select("id");
  if (error) {
    return {
      ok: false,
      error: writeError(
        error,
        "employee_plans.delete.rejected",
        ctx.userId,
        "No se pudo borrar el plan.",
      ),
    };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "No se pudo borrar el plan." };
  }
  await logAudit("employee.debt_plan_deleted", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}
