"use server";

import { logAudit } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan, userCanAll } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { formatMoney } from "@/lib/format";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  bulkCreatePayrollPayments,
  createPayrollPayment,
  loadPayrollBalances,
  payrollAccountProblem,
} from "@/lib/commands/pay-payroll";

import { exceedsBalance, payrollDbErrorMessage } from "../lib/payroll-payments";
import { HR_CASH_PERMISSIONS } from "../lib/hr-cash";
import {
  BulkCreatePayrollPaymentsSchema,
  CreatePayrollPaymentSchema,
  DeletePayrollPaymentSchema,
  isPayrollPaymentMethod,
  UpdatePayrollPaymentSchema,
  type PayrollPayment,
} from "../payroll-schema";

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
    return { ok: false, error: "No se pudieron cargar los pagos." };
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
  // A payment is a treasury movement: also transactions:write.
  if (!userCanAll(ctx.access, HR_CASH_PERMISSIONS)) {
    return { ok: false, error: "Sin permiso para registrar pagos." };
  }
  const parsed = CreatePayrollPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  return createPayrollPayment(ctx.userId, parsed.data);
}

export async function updatePayrollPaymentAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  // A payment is a treasury movement: also transactions:write.
  if (!userCanAll(ctx.access, HR_CASH_PERMISSIONS)) {
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
    const problem = await payrollAccountProblem(
      supabase,
      parsed.data.account_id,
    );
    if (problem) return { ok: false, error: problem };
  }

  if (!parsed.data.allow_overpay) {
    const balances = await loadPayrollBalances(supabase, [current.entry_id]);
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

export async function bulkCreatePayrollPaymentsAction(
  input: unknown,
): Promise<ActionResult<{ inserted: number }>> {
  const ctx = await requireUserContext();
  // A payment is a treasury movement: also transactions:write.
  if (!userCanAll(ctx.access, HR_CASH_PERMISSIONS)) {
    return { ok: false, error: "Sin permiso para registrar pagos." };
  }
  const parsed = BulkCreatePayrollPaymentsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  return bulkCreatePayrollPayments(ctx.userId, parsed.data);
}

export async function deletePayrollPaymentAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  // A payment is a treasury movement: also transactions:write.
  if (!userCanAll(ctx.access, HR_CASH_PERMISSIONS)) {
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
