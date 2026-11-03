"use server";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import {
  TREASURY_PERMISSIONS,
  userCan,
  userCanAll,
} from "@/lib/auth/permissions";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { applyFiscalFilter } from "@/lib/supabase/fiscal-filter";
import { fetchInChunks, paginateRange } from "@/lib/supabase/paginate";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { generateInstallments } from "@/lib/loans/amortization";
import {
  AdoptInstallmentPaymentSchema,
  CancelLoanSchema,
  CreateLoanSchema,
  PayInstallmentSchema,
  RecordDisbursementSchema,
  UpdateInstallmentSchema,
  splitTotal,
  type InstallmentSplit,
  type LoanDetail,
  type LoanInstallment,
  type LoanListItem,
  isInstallmentStatus,
  isLoanKind,
  isLoanStatus,
} from "../schema";

const LOAN_COLUMNS =
  "id, kind, description, lender, principal, currency, channel_id, installments_count, first_due_date, status, notes, created_at, disbursement_transaction_id, channel:invoicing_channels(name, is_fiscal)";

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
  capital_amount: number | null;
};

function summarize(
  rows: InstallmentAgg[],
  principal: number,
): Pick<
  LoanListItem,
  | "paid_total"
  | "pending_total"
  | "pending_count"
  | "next_due_date"
  | "capital_outstanding"
> {
  let paid = 0;
  let capitalPaid = 0;
  let pendingTotal = 0;
  let pendingCount = 0;
  let nextDue: string | null = null;
  for (const r of rows) {
    if (r.status === "pagada") {
      paid += Number(r.paid_amount ?? 0);
      capitalPaid += Number(r.capital_amount ?? r.paid_amount ?? 0);
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
    capital_outstanding: Math.max(
      0,
      Math.round((principal - capitalPaid) * 100) / 100,
    ),
  };
}

function readSplit(i: {
  capital_amount: number | null;
  interest_amount: number | null;
  iva_amount: number | null;
  perception_amount: number | null;
  other_charges_amount: number | null;
}): InstallmentSplit | null {
  if (i.capital_amount === null) return null;
  return {
    capital: Number(i.capital_amount),
    interest: Number(i.interest_amount ?? 0),
    iva: Number(i.iva_amount ?? 0),
    perception: Number(i.perception_amount ?? 0),
    other: Number(i.other_charges_amount ?? 0),
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
    disbursement_transaction_id: string | null;
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
    disbursement_transaction_id: loan.disbursement_transaction_id ?? null,
    ...agg,
  };
}

export async function listLoansAction(input?: {
  /** Scope filter (`isFiscalFor`): null/undefined = every channel. */
  isFiscal?: boolean | null;
}): Promise<ActionResult<LoanListItem[]>> {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, TREASURY_PERMISSIONS)) {
    return { ok: false, error: "Sin permiso para ver préstamos." };
  }
  const supabase = await createSupabaseClient();
  const { data: loans, error } = await paginateRange((from, to) =>
    applyFiscalFilter(
      supabase.from("loans").select(LOAN_COLUMNS),
      input?.isFiscal,
      "channel",
    )
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
          .select(
            "loan_id, amount, status, due_date, paid_amount, capital_amount",
          )
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
        capital_amount:
          i.capital_amount == null ? null : Number(i.capital_amount),
      });
      byLoan.set(i.loan_id, arr);
    }
  }
  return {
    ok: true,
    data: (loans ?? []).map((l) =>
      toListItem(l, summarize(byLoan.get(l.id) ?? [], Number(l.principal))),
    ),
  };
}

export async function getLoanAction(
  id: string,
  options?: {
    /** Scope filter (`isFiscalFor`): a loan outside it reads as not found. */
    isFiscal?: boolean | null;
  },
): Promise<ActionResult<LoanDetail>> {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, TREASURY_PERMISSIONS)) {
    return { ok: false, error: "Sin permiso para ver préstamos." };
  }
  const supabase = await createSupabaseClient();
  const { data: loan, error } = await applyFiscalFilter(
    supabase.from("loans").select(LOAN_COLUMNS).eq("id", id),
    options?.isFiscal,
    "channel",
  ).maybeSingle();
  if (error || !loan) {
    return { ok: false, error: "No se encontró el préstamo." };
  }
  const { data: insts, error: instsError } = await paginateRange((from, to) =>
    supabase
      .from("loan_installments")
      .select(
        "id, loan_id, number, due_date, amount, status, paid_date, paid_amount, transaction_id, notes, capital_amount, interest_amount, iva_amount, perception_amount, other_charges_amount",
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
    split: readSplit(i),
  }));
  const agg = summarize(
    installments.map((i) => ({
      loan_id: i.loan_id,
      amount: i.amount,
      status: i.status,
      due_date: i.due_date,
      paid_amount: i.paid_amount,
      capital_amount: i.split?.capital ?? null,
    })),
    Number(loan.principal),
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
  const { id, split, ...rest } = parsed.data;
  const supabase = await createSupabaseClient();

  const { data: inst } = await supabase
    .from("loan_installments")
    .select("status, capital_amount")
    .eq("id", id)
    .maybeSingle();
  if (!inst) return { ok: false, error: "No se encontró la cuota." };
  if (inst.status === "pagada") {
    return { ok: false, error: "No se puede editar una cuota ya pagada." };
  }
  if (
    split === undefined &&
    rest.amount !== undefined &&
    inst.capital_amount !== null
  ) {
    return {
      ok: false,
      error: "La cuota tiene desglose: cambiá el importe desde el desglose.",
    };
  }

  // A split fixes the amount to its sum (the table checks it); removing it
  // keeps the amount.
  const splitColumns =
    split === undefined
      ? {}
      : split === null
        ? {
            capital_amount: null,
            interest_amount: null,
            iva_amount: null,
            perception_amount: null,
            other_charges_amount: null,
          }
        : {
            amount: splitTotal(split),
            capital_amount: split.capital,
            interest_amount: split.interest,
            iva_amount: split.iva,
            perception_amount: split.perception,
            other_charges_amount: split.other,
          };

  const { error } = await supabase
    .from("loan_installments")
    .update({
      ...(rest.amount !== undefined && { amount: rest.amount }),
      ...(rest.due_date !== undefined && { due_date: rest.due_date }),
      ...(rest.notes !== undefined && { notes: rest.notes }),
      ...splitColumns,
    })
    .eq("id", id);
  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "loans.installment.update.rejected",
      userId: ctx.userId,
      id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("loans.installment.update.failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo actualizar la cuota." };
  }
  if (split !== undefined) {
    await logAudit(
      "loan.installment_split_updated",
      ctx.userId,
      { split: split === null ? null : { ...split } },
      id,
    );
  }
  return { ok: true, data: undefined };
}

export async function adoptInstallmentPaymentAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:write")) {
    return { ok: false, error: "Sin permiso para registrar pagos." };
  }
  const parsed = AdoptInstallmentPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { id, transaction_id } = parsed.data;
  const supabase = await createSupabaseClient();
  // One transaction: claims the pending cuota, takes ownership of the
  // expense (no second movement) and re-posts it as the cuota's payment.
  const { error } = await supabase.rpc("adopt_loan_installment_payment", {
    p_installment_id: id,
    p_transaction_id: transaction_id,
  });
  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "loans.installment.adopt.rejected",
      userId: ctx.userId,
      id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("loans.installment.adopt.failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo vincular el egreso a la cuota." };
  }
  await logAudit(
    "loan.installment_payment_adopted",
    ctx.userId,
    { installment_id: id },
    transaction_id,
  );
  return { ok: true, data: undefined };
}

export async function recordLoanDisbursementAction(
  input: unknown,
): Promise<ActionResult<{ transactionId: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:write")) {
    return { ok: false, error: "Sin permiso para registrar el desembolso." };
  }
  const parsed = RecordDisbursementSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const d = parsed.data;
  const supabase = await createSupabaseClient();
  const { data: transactionId, error } = await supabase.rpc(
    "record_loan_disbursement",
    {
      p_loan_id: d.loan_id,
      p_account_id: d.account_id ?? undefined,
      p_date: d.date ?? undefined,
      p_transaction_id: d.transaction_id ?? undefined,
    },
  );
  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "loans.disbursement.rejected",
      userId: ctx.userId,
      id: d.loan_id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("loans.disbursement.failed", {
      userId: ctx.userId,
      id: d.loan_id,
      error,
    });
    return { ok: false, error: "No se pudo registrar el desembolso." };
  }
  await logAudit(
    "loan.disbursement_recorded",
    ctx.userId,
    { transaction_id: transactionId, adopted: !!d.transaction_id },
    d.loan_id,
  );
  return { ok: true, data: { transactionId } };
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

  // One transaction: claims the pending installment (FOR UPDATE), books the
  // outflow on the loan's channel and closes the loan after the last one.
  const { data: transactionId, error } = await supabase.rpc(
    "pay_loan_installment",
    {
      p_installment_id: id,
      p_paid_date: paid_date,
      p_account_id: account_id,
      p_amount: amount,
    },
  );
  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "loans.installment.pay.rejected",
      userId: ctx.userId,
      id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("loans.installment.pay.failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo registrar el pago de la cuota." };
  }

  await logAudit(
    "loan.installment_paid",
    ctx.userId,
    { installment_id: id, amount },
    transactionId,
  );
  return { ok: true, data: { transactionId } };
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
