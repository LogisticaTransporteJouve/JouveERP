"use server";

import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { debtPlanKind } from "../account-schema";
import {
  isPayrollPaymentMethod,
  PayrollPaidSummarySchema,
  type PayrollPaidLine,
} from "../payroll-schema";

const FAILED = "No se pudo cargar cómo se pagó el sueldo.";

/**
 * How a planilla row's Pagado was paid: its salary payments, the adelantos
 * discounted that month and the savings plan cuotas imputed to it, by date.
 * The adelantos are the same the database counts in paid_advance: on a draft
 * planilla the active ARS adelantos started by its month (what remains); on a
 * closed one, what its close discounted from each adelanto.
 */
export async function getPayrollPaidSummaryAction(
  input: unknown,
): Promise<ActionResult<PayrollPaidLine[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    return { ok: false, error: "Sin permiso para ver pagos." };
  }
  const parsed = PayrollPaidSummarySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "ID inválido." };
  const entryId = parsed.data.entry_id;
  // A per-user deny of accounts:read hides the account names, not the lines.
  const showAccounts = userCan(ctx.access, "accounts:read");
  const supabase = await createSupabaseClient();

  const { data: entry, error: entryErr } = await supabase
    .from("payroll_entries")
    .select("id, employee_id, payroll_periods!inner(year, month, status)")
    .eq("id", entryId)
    .maybeSingle();
  if (entryErr) {
    logger.error("payroll.paid_summary.entry_failed", {
      userId: ctx.userId,
      error: entryErr,
    });
    return { ok: false, error: FAILED };
  }
  if (!entry) return { ok: false, error: "La fila de la planilla no existe." };
  const period = entry.payroll_periods;

  const [paymentsRes, extrasRes, advances] = await Promise.all([
    supabase
      .from("payroll_payments")
      .select(
        "id, amount, method, paid_at, account_id, invoicing_channels!inner(is_fiscal)",
      )
      .eq("entry_id", entryId)
      .order("paid_at", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("payroll_entry_extras")
      .select("id, amount, description, created_at")
      .eq("entry_id", entryId)
      .not("loan_installment_id", "is", null),
    period.status === "closed"
      ? closedAdvances(supabase, entryId)
      : draftAdvances(supabase, entry.employee_id, period.year, period.month),
  ]);
  if (paymentsRes.error || extrasRes.error || !advances.ok) {
    logger.error("payroll.paid_summary.read_failed", {
      userId: ctx.userId,
      error: paymentsRes.error ?? extrasRes.error ?? advances.error,
    });
    return { ok: false, error: FAILED };
  }

  // The account each adelanto was paid from: its cash movement's account.
  const planIds = advances.data.map((a) => a.plan_id);
  const advanceMoves = new Map<
    string,
    { date: string; account_id: string | null }
  >();
  if (planIds.length > 0) {
    const { data: moves, error: movesErr } = await supabase
      .from("employee_account_movements")
      .select("plan_id, movement_date, transactions(account_id)")
      .eq("kind", "advance")
      .in("plan_id", planIds);
    if (movesErr) {
      logger.error("payroll.paid_summary.advance_moves_failed", {
        userId: ctx.userId,
        error: movesErr,
      });
      return { ok: false, error: FAILED };
    }
    for (const m of moves ?? []) {
      if (!m.plan_id) continue;
      advanceMoves.set(m.plan_id, {
        date: m.movement_date,
        account_id: m.transactions?.account_id ?? null,
      });
    }
  }

  const accountIds = new Set<string>();
  for (const p of paymentsRes.data ?? []) accountIds.add(p.account_id);
  for (const m of advanceMoves.values()) {
    if (m.account_id) accountIds.add(m.account_id);
  }
  const accountName = new Map<string, string>();
  if (showAccounts && accountIds.size > 0) {
    const { data: accounts, error: accountsErr } = await supabase
      .from("accounts")
      .select("id, name")
      .in("id", [...accountIds]);
    if (accountsErr) {
      logger.error("payroll.paid_summary.accounts_failed", {
        userId: ctx.userId,
        error: accountsErr,
      });
      return { ok: false, error: FAILED };
    }
    for (const a of accounts ?? []) accountName.set(a.id, a.name);
  }
  const nameOf = (id: string | null) =>
    id === null ? null : (accountName.get(id) ?? null);

  const lines: PayrollPaidLine[] = [];
  for (const p of paymentsRes.data ?? []) {
    if (!isPayrollPaymentMethod(p.method)) {
      logger.error("payroll.unknown_payment_method", { value: p.method });
      continue;
    }
    lines.push({
      id: p.id,
      kind: "payment",
      date: p.paid_at,
      description: null,
      method: p.method,
      is_fiscal: p.invoicing_channels.is_fiscal,
      account_name: nameOf(p.account_id),
      amount: Number(p.amount),
    });
  }
  for (const a of advances.data) {
    const move = advanceMoves.get(a.plan_id);
    lines.push({
      id: a.plan_id,
      kind: "advance",
      date: move?.date ?? null,
      description: a.description,
      method: null,
      is_fiscal: null,
      account_name: nameOf(move?.account_id ?? null),
      amount: a.amount,
    });
  }
  for (const x of extrasRes.data ?? []) {
    lines.push({
      id: x.id,
      kind: "savings_plan",
      date: x.created_at.slice(0, 10),
      description: x.description,
      method: null,
      is_fiscal: null,
      account_name: null,
      amount: Number(x.amount),
    });
  }
  lines.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  return { ok: true, data: lines };
}

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;
type AdvanceShare = { plan_id: string; description: string; amount: number };
type AdvancesResult =
  | { ok: true; data: AdvanceShare[]; error?: undefined }
  | { ok: false; error: unknown };

/** Same rule as payroll_plan_advances: the active ARS adelantos started by
 *  the month, what remains of each. */
async function draftAdvances(
  supabase: Supabase,
  employeeId: string,
  year: number,
  month: number,
): Promise<AdvancesResult> {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const { data, error } = await supabase
    .from("v_employee_debt_plans")
    .select("id, description, total, installment_amount, remaining")
    .eq("employee_id", employeeId)
    .eq("status", "activo")
    .eq("currency", "ARS")
    .lte("start_month", first)
    .gt("remaining", 0);
  if (error) return { ok: false, error };
  const shares: AdvanceShare[] = [];
  for (const p of data ?? []) {
    if (!p.id || p.total === null || p.installment_amount === null) continue;
    const plan = {
      total: Number(p.total),
      installment_amount: Number(p.installment_amount),
    };
    if (debtPlanKind(plan) !== "advance") continue;
    shares.push({
      plan_id: p.id,
      description: p.description ?? "Adelanto",
      amount: Number(p.remaining ?? 0),
    });
  }
  return { ok: true, data: shares };
}

/** What the close discounted from each adelanto on this row. */
async function closedAdvances(
  supabase: Supabase,
  entryId: string,
): Promise<AdvancesResult> {
  const { data, error } = await supabase
    .from("employee_account_movements")
    .select(
      "amount, plan_id, employee_debt_plans!inner(description, total, installment_amount)",
    )
    .eq("payroll_entry_id", entryId)
    .eq("kind", "payroll_discount")
    .not("plan_id", "is", null);
  if (error) return { ok: false, error };
  const byPlan = new Map<string, AdvanceShare>();
  for (const m of data ?? []) {
    const plan = m.employee_debt_plans;
    if (!m.plan_id || debtPlanKind(plan) !== "advance") continue;
    const share = byPlan.get(m.plan_id) ?? {
      plan_id: m.plan_id,
      description: plan.description,
      amount: 0,
    };
    share.amount += Number(m.amount);
    byPlan.set(m.plan_id, share);
  }
  return { ok: true, data: [...byPlan.values()] };
}
