"use server";

import { logAudit } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { formatMoney } from "@/lib/format";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { isAccountType } from "@/features/accounts/schema";

import {
  exceedsBalance,
  payrollDbErrorMessage,
  payrollPayableAccounts,
} from "../lib/payroll-payments";
import {
  BulkCreatePayrollPaymentsSchema,
  CreatePayrollPaymentSchema,
  DeletePayrollPaymentSchema,
  isPayrollPaymentMethod,
  UpdatePayrollPaymentSchema,
  type PayrollPayment,
} from "../payroll-schema";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

function narrowPayment(row: {
  method: string;
  [key: string]: unknown;
}): PayrollPayment | null {
  if (!isPayrollPaymentMethod(row.method)) {
    logger.error("payroll.unknown_payment_method", { value: row.method });
    return null;
  }
  return row as PayrollPayment;
}

const COLS =
  "id, entry_id, account_id, channel_id, amount, method, paid_at, transaction_id, notes, created_by, created_at, updated_at";

/** Salaries are paid from active ARS cash/bank accounts only. */
async function accountProblem(
  supabase: Supabase,
  accountId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("accounts")
    .select("id, is_active, currency, type")
    .eq("id", accountId)
    .maybeSingle();
  if (error) return "No se pudo verificar la cuenta.";
  if (!data) return "La cuenta elegida no existe.";
  if (!isAccountType(data.type)) return "La cuenta elegida no es válida.";
  const [ok] = payrollPayableAccounts([
    { is_active: data.is_active, currency: data.currency, type: data.type },
  ]);
  if (ok) return null;
  if (data.currency !== "ARS") {
    return `Los sueldos se pagan desde una cuenta en pesos (la cuenta elegida es en ${data.currency}).`;
  }
  if (!data.is_active) return "La cuenta elegida está inactiva.";
  return "Los sueldos no se pagan desde una cartera de cheques.";
}

type EntryBalance = { id: string; saldo: number; employee_id: string };

async function loadBalances(
  supabase: Supabase,
  entryIds: readonly string[],
): Promise<Map<string, EntryBalance> | null> {
  const { data, error } = await supabase
    .from("v_payroll_entries_with_payments")
    .select("id, saldo, employee_id")
    .in("id", [...entryIds]);
  if (error) return null;
  const map = new Map<string, EntryBalance>();
  for (const row of data ?? []) {
    if (!row.id || !row.employee_id) continue;
    map.set(row.id, {
      id: row.id,
      saldo: Number(row.saldo ?? 0),
      employee_id: row.employee_id,
    });
  }
  return map;
}

export async function listPayrollPaymentsAction(
  entryId: string,
): Promise<ActionResult<PayrollPayment[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    return { ok: false, error: "Sin permiso para ver pagos." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("payroll_payments")
    .select(COLS)
    .eq("entry_id", entryId)
    .order("paid_at", { ascending: true });

  if (error) {
    logger.error("payroll_payments.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: error.message };
  }
  return {
    ok: true,
    data: (data ?? [])
      .map(narrowPayment)
      .filter((row): row is PayrollPayment => row !== null),
  };
}

export async function createPayrollPaymentAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso para registrar pagos." };
  }
  const parsed = CreatePayrollPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createSupabaseClient();
  const problem = await accountProblem(supabase, parsed.data.account_id);
  if (problem) return { ok: false, error: problem };

  if (!parsed.data.allow_overpay) {
    const balances = await loadBalances(supabase, [parsed.data.entry_id]);
    const entry = balances?.get(parsed.data.entry_id);
    if (!entry) return { ok: false, error: "No se encontró la liquidación." };
    if (exceedsBalance(parsed.data.amount, entry.saldo)) {
      return {
        ok: false,
        error: `El pago supera el saldo pendiente (${formatMoney(Math.max(entry.saldo, 0))}). Si es correcto, marcá "Pagar más que el saldo".`,
      };
    }
  }

  const { data, error } = await supabase
    .from("payroll_payments")
    .insert({
      entry_id: parsed.data.entry_id,
      account_id: parsed.data.account_id,
      channel_id: parsed.data.channel_id,
      amount: parsed.data.amount,
      method: parsed.data.method,
      paid_at: parsed.data.paid_at,
      notes: parsed.data.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    logger.error("payroll_payments.create.failed", {
      userId: ctx.userId,
      error,
    });
    return {
      ok: false,
      error: payrollDbErrorMessage(error, "No se pudo registrar el pago."),
    };
  }
  await logAudit(
    "payroll.payment_created",
    ctx.userId,
    {
      entry_id: parsed.data.entry_id,
      amount: parsed.data.amount,
      method: parsed.data.method,
      account_id: parsed.data.account_id,
      overpay_confirmed: parsed.data.allow_overpay === true,
    },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updatePayrollPaymentAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso para editar pagos." };
  }
  const parsed = UpdatePayrollPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createSupabaseClient();
  const { data: current, error: currentErr } = await supabase
    .from("payroll_payments")
    .select("id, entry_id, account_id, channel_id, amount, method, paid_at")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (currentErr) {
    return { ok: false, error: "No se pudo leer el pago." };
  }
  if (!current) return { ok: false, error: "El pago ya no existe." };

  if (parsed.data.account_id !== current.account_id) {
    const problem = await accountProblem(supabase, parsed.data.account_id);
    if (problem) return { ok: false, error: problem };
  }

  if (!parsed.data.allow_overpay) {
    const balances = await loadBalances(supabase, [current.entry_id]);
    const entry = balances?.get(current.entry_id);
    if (!entry) return { ok: false, error: "No se encontró la liquidación." };
    // The current payment already counts in `paid`; give its amount back.
    const available = entry.saldo + Number(current.amount);
    if (exceedsBalance(parsed.data.amount, available)) {
      return {
        ok: false,
        error: `El pago supera el saldo pendiente (${formatMoney(Math.max(available, 0))}). Si es correcto, marcá "Pagar más que el saldo".`,
      };
    }
  }

  const { data: updated, error } = await supabase
    .from("payroll_payments")
    .update({
      account_id: parsed.data.account_id,
      channel_id: parsed.data.channel_id,
      amount: parsed.data.amount,
      method: parsed.data.method,
      paid_at: parsed.data.paid_at,
      notes: parsed.data.notes ?? null,
    })
    .eq("id", parsed.data.id)
    .select("id");

  if (error) {
    logger.error("payroll_payments.update.failed", {
      userId: ctx.userId,
      error,
    });
    return {
      ok: false,
      error: payrollDbErrorMessage(error, "No se pudo editar el pago."),
    };
  }
  if (!updated || updated.length === 0) {
    return { ok: false, error: "No se pudo editar el pago." };
  }
  await logAudit(
    "payroll.payment_updated",
    ctx.userId,
    {
      before: {
        account_id: current.account_id,
        channel_id: current.channel_id,
        amount: Number(current.amount),
        method: current.method,
        paid_at: current.paid_at,
      },
      after: {
        account_id: parsed.data.account_id,
        channel_id: parsed.data.channel_id,
        amount: parsed.data.amount,
        method: parsed.data.method,
        paid_at: parsed.data.paid_at,
      },
      overpay_confirmed: parsed.data.allow_overpay === true,
    },
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}

// Bulk payment: 1 batch insert of N payroll_payments → trigger creates N
// transactions in the chosen account. If any one fails (e.g. an entry_id
// that doesn't exist), the whole batch transaction rolls back.
export async function bulkCreatePayrollPaymentsAction(
  input: unknown,
): Promise<ActionResult<{ inserted: number }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso para registrar pagos." };
  }
  const parsed = BulkCreatePayrollPaymentsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createSupabaseClient();
  const problem = await accountProblem(supabase, parsed.data.account_id);
  if (problem) return { ok: false, error: problem };

  if (!parsed.data.allow_overpay) {
    const balances = await loadBalances(supabase, parsed.data.entry_ids);
    if (!balances) {
      return { ok: false, error: "No se pudieron leer los saldos." };
    }
    const over = parsed.data.entry_ids.filter((id) => {
      const entry = balances.get(id);
      return !entry || exceedsBalance(parsed.data.amount_each, entry.saldo);
    });
    if (over.length > 0) {
      return {
        ok: false,
        error: `${over.length} empleado(s) quedarían con saldo negativo con ${formatMoney(parsed.data.amount_each)} cada uno. Bajá el monto, sacalos de la selección o marcá "Pagar más que el saldo".`,
      };
    }
  }

  const rows = parsed.data.entry_ids.map((entry_id) => ({
    entry_id,
    account_id: parsed.data.account_id,
    channel_id: parsed.data.channel_id,
    amount: parsed.data.amount_each,
    method: parsed.data.method,
    paid_at: parsed.data.paid_at,
    notes: parsed.data.notes ?? null,
    created_by: ctx.userId,
  }));

  const { data, error } = await supabase
    .from("payroll_payments")
    .insert(rows)
    .select("id");

  if (error) {
    logger.error("payroll_payments.bulk_create.failed", {
      userId: ctx.userId,
      count: rows.length,
      error,
    });
    return {
      ok: false,
      error: payrollDbErrorMessage(
        error,
        "No se pudo registrar el pago masivo.",
      ),
    };
  }
  await logAudit("payroll.payment_bulk_created", ctx.userId, {
    count: data?.length ?? 0,
    amount_each: parsed.data.amount_each,
    method: parsed.data.method,
    account_id: parsed.data.account_id,
    entry_ids: parsed.data.entry_ids,
    overpay_confirmed: parsed.data.allow_overpay === true,
  });
  return { ok: true, data: { inserted: data?.length ?? 0 } };
}

export async function deletePayrollPaymentAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:write")) {
    return { ok: false, error: "Sin permiso para borrar pagos." };
  }
  const parsed = DeletePayrollPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "ID inválido." };

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("payroll_payments")
    .delete()
    .eq("id", parsed.data.id)
    .select("id");

  if (error) {
    return {
      ok: false,
      error: payrollDbErrorMessage(error, "No se pudo borrar el pago."),
    };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "No se pudo borrar el pago." };
  }
  await logAudit("payroll.payment_deleted", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}
