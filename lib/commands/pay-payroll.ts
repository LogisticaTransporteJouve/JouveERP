import "server-only";

import { isAccountType } from "@/features/accounts/schema";
import {
  exceedsBalance,
  payrollDbErrorMessage,
  payrollPayableAccounts,
} from "@/features/hr/lib/payroll-payments";
import type {
  BulkCreatePayrollPaymentsInput,
  CreatePayrollPaymentInput,
} from "@/features/hr/payroll-schema";
import { logAudit } from "@/lib/actions/audit";
import { formatMoney } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

// "Pagar" and "Pago masivo" of the payroll month: payroll_payments rows, each
// of which a trigger turns into its Caja movement. With the caller's
// session (RLS). The callers have already checked HR_CASH_PERMISSIONS
// (hr:write + transactions:write) and parsed the input with the form's
// schema: the payroll dialogs and an accepted assistant proposal.

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Salaries are paid from active ARS cash/bank accounts only. */
export async function payrollAccountProblem(
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

/** The pending balance of each payroll entry, or null when unreadable. */
export async function loadPayrollBalances(
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

/** One salary payment: refused from an account salaries are not paid from,
 *  or above the entry's balance unless the user confirmed overpaying. */
export async function createPayrollPayment(
  actorId: string,
  input: CreatePayrollPaymentInput,
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const problem = await payrollAccountProblem(supabase, input.account_id);
  if (problem) return { ok: false, error: problem };

  if (!input.allow_overpay) {
    const balances = await loadPayrollBalances(supabase, [input.entry_id]);
    const entry = balances?.get(input.entry_id);
    if (!entry) return { ok: false, error: "No se encontró la liquidación." };
    if (exceedsBalance(input.amount, entry.saldo)) {
      return {
        ok: false,
        error: `El pago supera el saldo pendiente (${formatMoney(Math.max(entry.saldo, 0))}). Si es correcto, marcá "Pagar más que el saldo".`,
      };
    }
  }

  const { data, error } = await supabase
    .from("payroll_payments")
    .insert({
      entry_id: input.entry_id,
      account_id: input.account_id,
      channel_id: input.channel_id,
      amount: input.amount,
      method: input.method,
      paid_at: input.paid_at,
      notes: input.notes ?? null,
      created_by: actorId,
    })
    .select("id")
    .single();

  if (error || !data) {
    logger.error("payroll_payments.create.failed", { userId: actorId, error });
    return {
      ok: false,
      error: payrollDbErrorMessage(error, "No se pudo registrar el pago."),
    };
  }
  await logAudit(
    "payroll.payment_created",
    actorId,
    {
      entry_id: input.entry_id,
      amount: input.amount,
      method: input.method,
      account_id: input.account_id,
      overpay_confirmed: input.allow_overpay === true,
    },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

/** The bulk payment: one batch insert of N payments, each with its own
 *  amount, from one account and method. One statement: if any row fails
 *  (an entry that does not exist, a closed period) none is written. */
export async function bulkCreatePayrollPayments(
  actorId: string,
  input: BulkCreatePayrollPaymentsInput,
): Promise<ActionResult<{ inserted: number }>> {
  const supabase = await createClient();
  const problem = await payrollAccountProblem(supabase, input.account_id);
  if (problem) return { ok: false, error: problem };

  if (!input.allow_overpay) {
    const balances = await loadPayrollBalances(
      supabase,
      input.items.map((i) => i.entry_id),
    );
    if (!balances) {
      return { ok: false, error: "No se pudieron leer los saldos." };
    }
    const over = input.items.filter((item) => {
      const entry = balances.get(item.entry_id);
      return !entry || exceedsBalance(item.amount, entry.saldo);
    });
    if (over.length > 0) {
      return {
        ok: false,
        error: `${over.length} empleado(s) quedarían con saldo negativo. Bajá el monto, sacalos de la selección o marcá "Pagar más que el saldo".`,
      };
    }
  }

  const rows = input.items.map(({ entry_id, amount }) => ({
    entry_id,
    account_id: input.account_id,
    channel_id: input.channel_id,
    amount,
    method: input.method,
    paid_at: input.paid_at,
    notes: input.notes ?? null,
    created_by: actorId,
  }));

  const { data, error } = await supabase
    .from("payroll_payments")
    .insert(rows)
    .select("id");

  if (error) {
    logger.error("payroll_payments.bulk_create.failed", {
      userId: actorId,
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
  await logAudit("payroll.payment_bulk_created", actorId, {
    count: data?.length ?? 0,
    total: input.items.reduce((s, i) => s + i.amount, 0),
    method: input.method,
    account_id: input.account_id,
    items: input.items,
    overpay_confirmed: input.allow_overpay === true,
  });
  return { ok: true, data: { inserted: data?.length ?? 0 } };
}
