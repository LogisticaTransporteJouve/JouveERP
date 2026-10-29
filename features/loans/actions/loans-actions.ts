"use server";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { fetchInChunks, paginateRange } from "@/lib/supabase/paginate";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { createTransactionAction } from "@/features/transactions/actions/transactions-actions";

import { generateInstallments } from "../lib/amortization";
import {
  CancelLoanSchema,
  CreateLoanSchema,
  PayInstallmentSchema,
  UpdateInstallmentSchema,
  type LoanDetail,
  type LoanInstallment,
  type LoanListItem,
  isInstallmentStatus,
  isLoanKind,
  isLoanStatus,
} from "../schema";

const LOAN_COLUMNS =
  "id, kind, description, lender, principal, currency, channel_id, installments_count, first_due_date, status, notes, created_at, channel:invoicing_channels(name)";

function readChannelName(
  channel: { name: string } | { name: string }[] | null,
): string | null {
  const c = Array.isArray(channel) ? channel[0] : channel;
  return c?.name ?? null;
}

type InstallmentAgg = {
  loan_id: string;
  amount: number;
  status: string;
  due_date: string;
  paid_amount: number | null;
};

function summarize(
  rows: InstallmentAgg[],
): Pick<
  LoanListItem,
  "paid_total" | "pending_total" | "pending_count" | "next_due_date"
> {
  let paid = 0;
  let pendingTotal = 0;
  let pendingCount = 0;
  let nextDue: string | null = null;
  for (const r of rows) {
    if (r.status === "pagada") {
      paid += Number(r.paid_amount ?? 0);
    } else {
      pendingTotal += Number(r.amount);
      pendingCount += 1;
      if (nextDue === null || r.due_date < nextDue) nextDue = r.due_date;
    }
  }
  return {
    paid_total: Math.round(paid * 100) / 100,
    pending_total: Math.round(pendingTotal * 100) / 100,
    pending_count: pendingCount,
    next_due_date: nextDue,
  };
}

function toListItem(
  loan: {
    id: string;
    kind: string;
    description: string;
    lender: string | null;
    principal: number | string;
    currency: string;
    channel_id: string;
    installments_count: number;
    first_due_date: string;
    status: string;
    notes: string | null;
    created_at: string;
    channel: { name: string } | { name: string }[] | null;
  },
  agg: ReturnType<typeof summarize>,
): LoanListItem {
  return {
    id: loan.id,
    kind: isLoanKind(loan.kind) ? loan.kind : "prestamo",
    description: loan.description,
    lender: loan.lender,
    principal: Number(loan.principal),
    currency: loan.currency,
    channel_id: loan.channel_id,
    channel_name: readChannelName(loan.channel),
    installments_count: loan.installments_count,
    first_due_date: loan.first_due_date,
    status: isLoanStatus(loan.status) ? loan.status : "active",
    notes: loan.notes,
    created_at: loan.created_at,
    ...agg,
  };
}

export async function listLoansAction(): Promise<ActionResult<LoanListItem[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    return { ok: false, error: "Sin permiso para ver préstamos." };
  }
  const supabase = await createSupabaseClient();
  const { data: loans, error } = await paginateRange((from, to) =>
    supabase
      .from("loans")
      .select(LOAN_COLUMNS)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to),
  );
  if (error) {
    logger.error("loans.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron cargar los préstamos." };
  }
  const ids = (loans ?? []).map((l) => l.id);
  const byLoan = new Map<string, InstallmentAgg[]>();
  if (ids.length > 0) {
    // Every installment of every loan: a truncated set would misstate the
    // paid / pending totals.
    const insts = await fetchInChunks(ids, (chunkIds) =>
      paginateRange((from, to) =>
        supabase
          .from("loan_installments")
          .select("loan_id, amount, status, due_date, paid_amount")
          .in("loan_id", chunkIds)
          .order("id")
          .range(from, to),
      ),
    );
    if (insts.error) {
      logger.error("loans.installments.failed", {
        userId: ctx.userId,
        error: insts.error,
      });
      return { ok: false, error: "No se pudieron cargar los préstamos." };
    }
    for (const i of insts.data) {
      const arr = byLoan.get(i.loan_id) ?? [];
      arr.push({
        loan_id: i.loan_id,
        amount: Number(i.amount),
        status: i.status,
        due_date: i.due_date,
        paid_amount: i.paid_amount === null ? null : Number(i.paid_amount),
      });
      byLoan.set(i.loan_id, arr);
    }
  }
  return {
    ok: true,
    data: (loans ?? []).map((l) =>
      toListItem(l, summarize(byLoan.get(l.id) ?? [])),
    ),
  };
}

export async function getLoanAction(
  id: string,
): Promise<ActionResult<LoanDetail>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    return { ok: false, error: "Sin permiso para ver préstamos." };
  }
  const supabase = await createSupabaseClient();
  const { data: loan, error } = await supabase
    .from("loans")
    .select(LOAN_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error || !loan) {
    return { ok: false, error: "No se encontró el préstamo." };
  }
  const { data: insts, error: instsError } = await paginateRange((from, to) =>
    supabase
      .from("loan_installments")
      .select(
        "id, loan_id, number, due_date, amount, status, paid_date, paid_amount, transaction_id, notes",
      )
      .eq("loan_id", id)
      .order("number")
      .order("id")
      .range(from, to),
  );
  if (instsError) {
    logger.error("loans.detail.installments_failed", {
      userId: ctx.userId,
      error: instsError,
    });
    return { ok: false, error: "No se pudo cargar el préstamo." };
  }
  const installments: LoanInstallment[] = (insts ?? []).map((i) => ({
    id: i.id,
    loan_id: i.loan_id,
    number: i.number,
    due_date: i.due_date,
    amount: Number(i.amount),
    status: isInstallmentStatus(i.status) ? i.status : "pendiente",
    paid_date: i.paid_date,
    paid_amount: i.paid_amount === null ? null : Number(i.paid_amount),
    transaction_id: i.transaction_id,
    notes: i.notes,
  }));
  const agg = summarize(
    installments.map((i) => ({
      loan_id: i.loan_id,
      amount: i.amount,
      status: i.status,
      due_date: i.due_date,
      paid_amount: i.paid_amount,
    })),
  );
  return { ok: true, data: { ...toListItem(loan, agg), installments } };
}

export async function createLoanAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:write")) {
    return { ok: false, error: "Sin permiso para crear préstamos." };
  }
  const parsed = CreateLoanSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const d = parsed.data;
  const supabase = await createSupabaseClient();

  const { data: loan, error } = await supabase
    .from("loans")
    .insert({
      kind: d.kind,
      description: d.description,
      lender: d.lender ?? null,
      principal: d.principal,
      currency: d.currency,
      channel_id: d.channel_id,
      installments_count: d.installments_count,
      first_due_date: d.first_due_date,
      notes: d.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !loan) {
    logger.error("loans.create.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo crear el préstamo." };
  }

  const schedule = generateInstallments(
    d.principal,
    d.installments_count,
    d.first_due_date,
  );
  const { error: instErr } = await supabase.from("loan_installments").insert(
    schedule.map((s) => ({
      loan_id: loan.id,
      number: s.number,
      due_date: s.due_date,
      amount: s.amount,
    })),
  );
  if (instErr) {
    // Roll back the loan so we never leave one without its schedule.
    await supabase.from("loans").delete().eq("id", loan.id);
    logger.error("loans.installments.create.failed", {
      userId: ctx.userId,
      error: instErr,
    });
    return { ok: false, error: "No se pudo generar el cronograma de cuotas." };
  }

  await logAudit("loan.created", ctx.userId, { kind: d.kind }, loan.id);
  return { ok: true, data: { id: loan.id } };
}

export async function updateInstallmentAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:write")) {
    return { ok: false, error: "Sin permiso para editar cuotas." };
  }
  const parsed = UpdateInstallmentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { id, ...rest } = parsed.data;
  const supabase = await createSupabaseClient();

  const { data: inst } = await supabase
    .from("loan_installments")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (!inst) return { ok: false, error: "No se encontró la cuota." };
  if (inst.status === "pagada") {
    return { ok: false, error: "No se puede editar una cuota ya pagada." };
  }

  const { error } = await supabase
    .from("loan_installments")
    .update({
      ...(rest.amount !== undefined && { amount: rest.amount }),
      ...(rest.due_date !== undefined && { due_date: rest.due_date }),
      ...(rest.notes !== undefined && { notes: rest.notes }),
    })
    .eq("id", id);
  if (error) {
    logger.error("loans.installment.update.failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo actualizar la cuota." };
  }
  return { ok: true, data: undefined };
}

export async function payInstallmentAction(
  input: unknown,
): Promise<ActionResult<{ transactionId: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:write")) {
    return { ok: false, error: "Sin permiso para registrar pagos." };
  }
  const parsed = PayInstallmentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { id, paid_date, account_id, amount } = parsed.data;
  const supabase = await createSupabaseClient();

  const { data: inst } = await supabase
    .from("loan_installments")
    .select(
      "id, number, status, loan:loans(id, description, kind, currency, channel_id, installments_count)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!inst) return { ok: false, error: "No se encontró la cuota." };
  if (inst.status === "pagada") {
    return { ok: false, error: "La cuota ya está pagada." };
  }
  const loan = Array.isArray(inst.loan) ? inst.loan[0] : inst.loan;
  if (!loan) return { ok: false, error: "No se encontró el préstamo." };

  // 1) Cash outflow in the chosen account, on the loan's channel (blanco/negro).
  const txRes = await createTransactionAction({
    account_id,
    channel_id: loan.channel_id,
    kind: "expense",
    amount,
    currency: loan.currency,
    transaction_date: paid_date,
    accrual_month: `${paid_date.slice(0, 7)}-01`,
    description: `Cuota ${inst.number}/${loan.installments_count} — ${loan.description}`,
  });
  if (!txRes.ok) return txRes;

  // 2) Mark the installment paid + link the transaction.
  const { error: updErr } = await supabase
    .from("loan_installments")
    .update({
      status: "pagada",
      paid_date,
      paid_amount: amount,
      transaction_id: txRes.data.id,
    })
    .eq("id", id);
  if (updErr) {
    logger.error("loans.installment.pay.failed", {
      userId: ctx.userId,
      id,
      transactionId: txRes.data.id,
      error: updErr,
    });
    return {
      ok: false,
      error:
        "Se registró el egreso pero no se marcó la cuota. Revisá el movimiento antes de reintentar.",
    };
  }

  // 3) If no pending installments remain, close the loan.
  const { count } = await supabase
    .from("loan_installments")
    .select("id", { count: "exact", head: true })
    .eq("loan_id", loan.id)
    .eq("status", "pendiente");
  if ((count ?? 0) === 0) {
    await supabase.from("loans").update({ status: "paid" }).eq("id", loan.id);
  }

  await logAudit(
    "loan.installment_paid",
    ctx.userId,
    { loan_id: loan.id, number: inst.number, amount },
    txRes.data.id,
  );
  return { ok: true, data: { transactionId: txRes.data.id } };
}

export async function cancelLoanAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:write")) {
    return { ok: false, error: "Sin permiso para anular préstamos." };
  }
  const parsed = CancelLoanSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." };
  }
  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("loans")
    .update({ status: "cancelled" })
    .eq("id", parsed.data.id);
  if (error) {
    logger.error("loans.cancel.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo anular el préstamo." };
  }
  await logAudit("loan.cancelled", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}
