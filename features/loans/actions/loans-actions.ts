"use server";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import {
  TREASURY_PERMISSIONS,
  userCan,
  userCanAll,
} from "@/lib/auth/permissions";
import { payLoanInstallment } from "@/lib/commands/pay-loan-installment";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { applyFiscalFilter } from "@/lib/supabase/fiscal-filter";
import { fetchInChunks, paginateRange } from "@/lib/supabase/paginate";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

import { generateInstallments } from "@/lib/loans/amortization";
import { fiscalYearMonths, fiscalYearOf } from "@/lib/fiscal-year";
import { readFiscalYearStartMonth } from "@/lib/fiscal-year-settings";
import { todayInAR } from "@/lib/format";
import { fetchUsdRateOnOrBefore, type UsdRate } from "@/lib/fx";
import { z } from "zod";

const BankPaymentsResultSchema = z.object({
  inserted: z.number(),
  booked: z.number(),
});
import { LOAN_CASH_PERMISSIONS } from "../lib/loan-cash";
import {
  AdoptInstallmentPaymentSchema,
  ApplyInstallmentStatementSchema,
  CancelLoanSchema,
  BookLoanOpeningSchema,
  CreateLoanSchema,
  RecordBankPaymentsSchema,
  PayInstallmentSchema,
  RepayCapitalSchema,
  RecordDisbursementSchema,
  UpdateInstallmentSchema,
  splitTotal,
  type InstallmentSplit,
  type LoanDetail,
  type LoanInstallment,
  type LoanListItem,
  isInstallmentKind,
  isInstallmentStatus,
  isLoanChargeConcept,
  type LoanInstallmentCharge,
  isLoanKind,
  isLoanStatus,
} from "../schema";

const LOAN_COLUMNS =
  "id, kind, description, lender, principal, currency, channel_id, installments_count, first_due_date, status, notes, created_at, disbursement_transaction_id, loan_number, account_id, start_date, original_amount, tna, tea, cft, is_open_ended, monthly_rate, salary_employee_id, channel:invoicing_channels(name, is_fiscal), account:accounts(name), salary_employee:employees(legal_name)";

const numOrNull = (v: number | string | null) =>
  v === null ? null : Number(v);

function readChannelName(
  channel: { name: string } | { name: string }[] | null,
): string | null {
  const c = Array.isArray(channel) ? channel[0] : channel;
  return c?.name ?? null;
}

function readChannelIsFiscal(
  channel: { is_fiscal: boolean } | { is_fiscal: boolean }[] | null,
): boolean {
  const c = Array.isArray(channel) ? channel[0] : channel;
  return c?.is_fiscal ?? false;
}

function readEmployeeName(
  employee: { legal_name: string } | { legal_name: string }[] | null,
): string | null {
  const e = Array.isArray(employee) ? employee[0] : employee;
  return e?.legal_name ?? null;
}

type InstallmentAgg = {
  loan_id: string;
  amount: number;
  status: string;
  due_date: string;
  paid_amount: number | null;
  capital_amount: number | null;
  interest_amount: number | null;
  paid_outside: boolean;
};

function summarize(
  rows: InstallmentAgg[],
  principal: number,
): Pick<
  LoanListItem,
  | "paid_total"
  | "paid_count"
  | "interest_paid"
  | "next_due_amount"
  | "pending_total"
  | "pending_count"
  | "next_due_date"
  | "capital_outstanding"
  | "accumulated"
> {
  let paid = 0;
  let paidCount = 0;
  let interestPaid = 0;
  let capitalPaid = 0;
  let pendingTotal = 0;
  let pendingCount = 0;
  let nextDue: string | null = null;
  let nextAmount: number | null = null;
  for (const r of rows) {
    if (r.status === "pagada") {
      paidCount += 1;
      if (!r.paid_outside) paid += Number(r.paid_amount ?? 0);
      interestPaid += Number(r.interest_amount ?? 0);
      capitalPaid += Number(r.capital_amount ?? r.paid_amount ?? 0);
    } else {
      pendingTotal += Number(r.amount);
      pendingCount += 1;
      if (nextDue === null || r.due_date < nextDue) {
        nextDue = r.due_date;
        nextAmount = Number(r.amount);
      }
    }
  }
  return {
    paid_total: Math.round(paid * 100) / 100,
    paid_count: paidCount,
    interest_paid: Math.round(interestPaid * 100) / 100,
    next_due_amount: nextAmount,
    pending_total: Math.round(pendingTotal * 100) / 100,
    pending_count: pendingCount,
    next_due_date: nextDue,
    capital_outstanding: Math.max(
      0,
      Math.round((principal - capitalPaid) * 100) / 100,
    ),
    accumulated: Math.round(capitalPaid * 100) / 100,
  };
}

function readSplit(i: {
  capital_amount: number | null;
  interest_amount: number | null;
  iva_amount: number | null;
  perception_amount: number | null;
  iva_perception_amount: number | null;
  other_charges_amount: number | null;
}): InstallmentSplit | null {
  if (i.capital_amount === null) return null;
  // perception_amount is the total; its IVA part never counts above it.
  const perceptions = Number(i.perception_amount ?? 0);
  const ivaPerception = Math.min(
    Number(i.iva_perception_amount ?? 0),
    perceptions,
  );
  return {
    capital: Number(i.capital_amount),
    interest: Number(i.interest_amount ?? 0),
    iva: Number(i.iva_amount ?? 0),
    perception: Math.round((perceptions - ivaPerception) * 100) / 100,
    iva_perception: ivaPerception,
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
    loan_number: string | null;
    account_id: string | null;
    start_date: string | null;
    original_amount: number | string | null;
    tna: number | string | null;
    tea: number | string | null;
    cft: number | string | null;
    is_open_ended: boolean;
    monthly_rate: number | string | null;
    channel:
      | { name: string; is_fiscal: boolean }
      | { name: string; is_fiscal: boolean }[]
      | null;
    account: { name: string } | { name: string }[] | null;
    salary_employee_id: string | null;
    salary_employee: { legal_name: string } | { legal_name: string }[] | null;
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
    channel_is_fiscal: readChannelIsFiscal(loan.channel),
    installments_count: loan.installments_count,
    first_due_date: loan.first_due_date,
    status: isLoanStatus(loan.status) ? loan.status : "active",
    notes: loan.notes,
    created_at: loan.created_at,
    disbursement_transaction_id: loan.disbursement_transaction_id ?? null,
    loan_number: loan.loan_number,
    account_id: loan.account_id,
    account_name: readChannelName(loan.account),
    start_date: loan.start_date,
    original_amount: numOrNull(loan.original_amount),
    tna: numOrNull(loan.tna),
    tea: numOrNull(loan.tea),
    cft: numOrNull(loan.cft),
    is_open_ended: loan.is_open_ended,
    monthly_rate: numOrNull(loan.monthly_rate),
    salary_employee_id: loan.salary_employee_id,
    salary_employee_name: readEmployeeName(loan.salary_employee),
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
            "loan_id, amount, status, due_date, paid_amount, capital_amount, interest_amount, paid_outside",
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
        interest_amount:
          i.interest_amount == null ? null : Number(i.interest_amount),
        paid_outside: i.paid_outside,
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
        "id, loan_id, number, kind, due_date, amount, status, paid_date, paid_amount, paid_amount_ars, paid_rate, transaction_id, notes, capital_amount, interest_amount, iva_amount, perception_amount, iva_perception_amount, other_charges_amount, paid_outside",
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
  const { data: chargeRows, error: chargesError } = await supabase
    .from("loan_installment_charges")
    .select(
      "id, installment_id, concept, description, amount, iva_amount, created_at, installment:loan_installments!inner(loan_id)",
    )
    .eq("installment.loan_id", id)
    .order("created_at")
    .order("id")
    .limit(5000);
  if (chargesError) {
    logger.error("loans.detail.charges_failed", {
      userId: ctx.userId,
      error: chargesError,
    });
    return { ok: false, error: "No se pudo cargar el préstamo." };
  }
  const chargesOf = new Map<string, LoanInstallmentCharge[]>();
  for (const c of chargeRows ?? []) {
    if (!isLoanChargeConcept(c.concept)) continue;
    chargesOf.set(c.installment_id, [
      ...(chargesOf.get(c.installment_id) ?? []),
      {
        id: c.id,
        concept: c.concept,
        description: c.description,
        amount: Number(c.amount),
        iva_amount: Number(c.iva_amount),
      },
    ]);
  }
  const installments: LoanInstallment[] = (insts ?? []).map((i) => ({
    id: i.id,
    loan_id: i.loan_id,
    number: i.number,
    kind: isInstallmentKind(i.kind) ? i.kind : "cuota",
    due_date: i.due_date,
    amount: Number(i.amount),
    status: isInstallmentStatus(i.status) ? i.status : "pendiente",
    paid_date: i.paid_date,
    paid_amount: i.paid_amount === null ? null : Number(i.paid_amount),
    paid_amount_ars: numOrNull(i.paid_amount_ars),
    paid_rate: numOrNull(i.paid_rate),
    transaction_id: i.transaction_id,
    notes: i.notes,
    split: readSplit(i),
    paid_outside: i.paid_outside,
    charges: chargesOf.get(i.id) ?? [],
  }));
  const agg = summarize(
    installments.map((i) => ({
      loan_id: i.loan_id,
      amount: i.amount,
      status: i.status,
      due_date: i.due_date,
      paid_amount: i.paid_amount,
      capital_amount: i.split?.capital ?? null,
      interest_amount: i.split?.interest ?? null,
      paid_outside: i.paid_outside,
    })),
    Number(loan.principal),
  );
  const [payments, opening, bookFrom] = await Promise.all([
    supabase
      .from("loan_bank_payments")
      .select(
        "id, receipt_number, paid_date, installment_number, total, capital, interest, late_interest, iva, iva_perception, iibb_perception, journal_entry_id",
      )
      .eq("loan_id", id)
      .order("paid_date")
      .order("receipt_number")
      .limit(1000),
    supabase
      .from("loans")
      .select("opening_journal_entry_id")
      .eq("id", id)
      .maybeSingle(),
    fiscalYearBookFrom(ctx.userId),
  ]);
  if (payments.error || opening.error || !bookFrom.ok) {
    logger.error("loans.detail.bank_payments_failed", {
      userId: ctx.userId,
      error: payments.error ?? opening.error,
    });
    return { ok: false, error: "No se pudo cargar el préstamo." };
  }
  return {
    ok: true,
    data: {
      ...toListItem(loan, agg),
      installments,
      bank_payments: payments.data.map((p) => ({
        ...p,
        total: Number(p.total),
        capital: Number(p.capital),
        interest: Number(p.interest),
        late_interest: Number(p.late_interest),
        iva: Number(p.iva),
        iva_perception: Number(p.iva_perception),
        iibb_perception: Number(p.iibb_perception),
      })),
      opening_booked: opening.data?.opening_journal_entry_id != null,
      book_from: bookFrom.data,
    },
  };
}

/** The first day of the earliest fiscal year still open: the one after the
 *  last closed period, and never later than the previous fiscal year (the
 *  one about to be closed). The bank receipts of a loan in course are
 *  booked from then on; earlier years are closed. */
async function fiscalYearBookFrom(
  userId: string,
): Promise<ActionResult<string>> {
  const startMonth = await readFiscalYearStartMonth(userId);
  if (!startMonth.ok) return startMonth;
  const closed = await getServiceClient()
    .from("accounting_closed_periods")
    .select("period")
    .order("period", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (closed.error) {
    logger.error("loans.book_from.closed_failed", {
      userId,
      error: closed.error,
    });
    return { ok: false, error: "No se pudieron leer los períodos cerrados." };
  }
  const current = fiscalYearOf(todayInAR().slice(0, 7), startMonth.data);
  const afterClosed = closed.data
    ? fiscalYearOf(closed.data.period, startMonth.data) + 1
    : current - 1;
  const year = Math.min(current, Math.max(current - 1, afterClosed));
  return {
    ok: true,
    data: `${fiscalYearMonths(year, startMonth.data)[0]}-01`,
  };
}

/** Loads the bank's payment receipts of a loan (read from their PDFs in the
 *  browser): stores them and books, without Caja, those of cuotas paid before
 *  the loan was loaded within the current fiscal year. */
export async function recordBankPaymentsAction(
  input: unknown,
): Promise<ActionResult<{ inserted: number; booked: number; other: number }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:write")) {
    return { ok: false, error: "Sin permiso para cargar pagos de préstamos." };
  }
  const parsed = RecordBankPaymentsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const supabase = await createSupabaseClient();
  const loan = await supabase
    .from("loans")
    .select("loan_number")
    .eq("id", parsed.data.loan_id)
    .maybeSingle();
  if (loan.error || !loan.data) {
    return { ok: false, error: "No se encontró el préstamo." };
  }
  const loanNumber = loan.data.loan_number;
  if (!loanNumber) {
    return {
      ok: false,
      error:
        "Cargá el número de préstamo del banco: con él se sabe qué comprobantes son de este préstamo.",
    };
  }
  const mine = parsed.data.payments.filter((p) => p.loan_number === loanNumber);
  const other = parsed.data.payments.length - mine.length;
  if (mine.length === 0) {
    return {
      ok: false,
      error: `Ningún comprobante es del préstamo ${loanNumber}.`,
    };
  }
  const bookFrom = await fiscalYearBookFrom(ctx.userId);
  if (!bookFrom.ok) return bookFrom;
  // The RPC is service-role only: the gate above is the authorization.
  const { data, error } = await getServiceClient().rpc(
    "record_loan_bank_payments",
    {
      p_loan_id: parsed.data.loan_id,
      p_payments: mine.map(({ loan_number: _n, ...p }) => p),
      p_book_from: bookFrom.data,
      p_user_id: ctx.userId,
    },
  );
  if (error || !data) {
    const guardError = mapDbGuardError(error, {
      slug: "loans.bank_payments.rejected",
      userId: ctx.userId,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("loans.bank_payments.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron cargar los comprobantes." };
  }
  const result = BankPaymentsResultSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, error: "No se pudieron cargar los comprobantes." };
  }
  await logAudit(
    "loan.bank_payments_recorded",
    ctx.userId,
    result.data,
    parsed.data.loan_id,
  );
  return { ok: true, data: { ...result.data, other } };
}

/** Sets a pending cuota as the lender's statement bills it (read from its
 *  PDF in the browser): capital, interest, their IVA and each charge. */
export async function applyInstallmentStatementAction(
  input: unknown,
): Promise<ActionResult<{ installment_number: number; amount: number }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:write")) {
    return { ok: false, error: "Sin permiso para editar cuotas." };
  }
  const parsed = ApplyInstallmentStatementSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const d = parsed.data;
  const supabase = await createSupabaseClient();
  const loan = await supabase
    .from("loans")
    .select("loan_number")
    .eq("id", d.loan_id)
    .maybeSingle();
  if (loan.error || !loan.data) {
    return { ok: false, error: "No se encontró el préstamo." };
  }
  if (
    d.operation &&
    loan.data.loan_number &&
    d.operation !== loan.data.loan_number
  ) {
    return {
      ok: false,
      error: `El resumen es de la operación ${d.operation}, no de ${loan.data.loan_number}.`,
    };
  }
  const inst = await supabase
    .from("loan_installments")
    .select("id, status")
    .eq("loan_id", d.loan_id)
    .eq("number", d.installment_number)
    .maybeSingle();
  if (inst.error) {
    logger.error("loans.statement.installment_read_failed", {
      userId: ctx.userId,
      error: inst.error,
    });
    return { ok: false, error: "No se pudo leer la cuota." };
  }
  if (!inst.data) {
    return {
      ok: false,
      error: `El préstamo no tiene la cuota ${d.installment_number}.`,
    };
  }
  if (inst.data.status !== "pendiente") {
    return {
      ok: false,
      error: `La cuota ${d.installment_number} ya está pagada.`,
    };
  }
  // The RPC is service-role only: the gate above is the authorization.
  const { data: amount, error } = await getServiceClient().rpc(
    "set_loan_installment_charges",
    {
      p_installment_id: inst.data.id,
      p_split: {
        capital: d.capital,
        interest: d.interest,
        iva: d.iva,
        perception: 0,
        iva_perception: 0,
      },
      p_charges: d.charges,
    },
  );
  if (error || amount === null) {
    const guardError = mapDbGuardError(error, {
      slug: "loans.statement.rejected",
      userId: ctx.userId,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("loans.statement.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo actualizar la cuota." };
  }
  await logAudit(
    "loan.installment_statement_applied",
    ctx.userId,
    {
      installment_number: d.installment_number,
      amount: Number(amount),
      charges: d.charges.length,
    },
    inst.data.id,
  );
  return {
    ok: true,
    data: { installment_number: d.installment_number, amount: Number(amount) },
  };
}

/** Books the capital the loan owed at the start of the fiscal year. */
export async function bookLoanOpeningAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:write")) {
    return { ok: false, error: "Sin permiso para registrar la deuda." };
  }
  const parsed = BookLoanOpeningSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const bookFrom = await fiscalYearBookFrom(ctx.userId);
  if (!bookFrom.ok) return bookFrom;
  const { error } = await getServiceClient().rpc("book_loan_opening", {
    p_loan_id: parsed.data.loan_id,
    p_date: bookFrom.data,
  });
  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "loans.opening.rejected",
      userId: ctx.userId,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("loans.opening.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo registrar la deuda de apertura." };
  }
  await logAudit("loan.opening_booked", ctx.userId, {}, parsed.data.loan_id);
  return { ok: true, data: undefined };
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
  // Imputing a plan to an employee writes their planilla on every cuota paid.
  if (d.salary_employee_id && !userCan(ctx.access, "hr:write")) {
    return {
      ok: false,
      error: "Sin permiso para imputar el plan a un empleado.",
    };
  }
  const supabase = await createSupabaseClient();

  // An open-ended loan has no schedule: the database generates its next
  // interest cuotas from the monthly rate.
  if (d.is_open_ended) {
    const { data: loanId, error } = await supabase.rpc("create_loan", {
      p_loan: {
        kind: "prestamo",
        description: d.description,
        lender: d.lender ?? null,
        principal: d.principal,
        currency: d.currency,
        channel_id: d.channel_id,
        installments_count: 1,
        first_due_date: d.first_due_date,
        notes: d.notes ?? null,
        loan_number: d.loan_number ?? null,
        account_id: d.account_id ?? null,
        start_date: d.start_date ?? null,
        original_amount: d.original_amount ?? null,
        tna: d.tna ?? null,
        tea: d.tea ?? null,
        cft: d.cft ?? null,
        is_open_ended: true,
        monthly_rate: d.monthly_rate ?? null,
      },
      p_installments: [],
    });
    if (error || !loanId) {
      const guardError = mapDbGuardError(error, {
        slug: "loans.create.rejected",
        userId: ctx.userId,
      });
      if (guardError) return { ok: false, error: guardError };
      logger.error("loans.create.failed", { userId: ctx.userId, error });
      return { ok: false, error: "No se pudo crear el préstamo." };
    }
    await logAudit(
      "loan.created",
      ctx.userId,
      { kind: "prestamo", is_open_ended: true },
      loanId,
    );
    return { ok: true, data: { id: loanId } };
  }

  // The bank's plan (or the French one from the TNA) sets the cuotas, their
  // split and which were paid before; without it, equal parts of the capital.
  const plan = d.plan ?? null;
  const schedule = plan
    ? plan.map((p) => ({
        number: p.number,
        due_date: p.due_date,
        amount: p.amount,
        capital: p.capital,
        interest: p.interest,
        iva: p.iva,
        // The RPC takes the total of perceptions and its IVA part.
        perception: Math.round((p.perception + p.iva_perception) * 100) / 100,
        iva_perception: p.iva_perception,
        other: p.other,
        paid_outside: p.paid,
      }))
    : generateInstallments(d.principal, d.installments_count, d.first_due_date);
  if (plan && plan.every((p) => p.paid)) {
    return {
      ok: false,
      error: "Todas las cuotas figuran pagadas: no hay nada para seguir.",
    };
  }
  // One transaction: the loan never exists without its schedule.
  const { data: loanId, error } = await supabase.rpc("create_loan", {
    p_loan: {
      kind: d.kind,
      description: d.description,
      lender: d.lender ?? null,
      principal: d.principal,
      currency: d.currency,
      channel_id: d.channel_id,
      installments_count: schedule.length,
      first_due_date: schedule[0]?.due_date ?? d.first_due_date,
      notes: d.notes ?? null,
      loan_number: d.loan_number ?? null,
      account_id: d.account_id ?? null,
      start_date: d.start_date ?? null,
      original_amount: d.original_amount ?? null,
      tna: d.tna ?? null,
      tea: d.tea ?? null,
      cft: d.cft ?? null,
      salary_employee_id:
        d.kind === "plan_ahorro" ? (d.salary_employee_id ?? null) : null,
    },
    p_installments: schedule,
  });
  if (error || !loanId) {
    const guardError = mapDbGuardError(error, {
      slug: "loans.create.rejected",
      userId: ctx.userId,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("loans.create.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo crear el préstamo." };
  }

  await logAudit(
    "loan.created",
    ctx.userId,
    {
      kind: d.kind,
      ...(d.kind === "plan_ahorro" && d.salary_employee_id
        ? { salary_employee_id: d.salary_employee_id }
        : {}),
    },
    loanId,
  );
  return { ok: true, data: { id: loanId } };
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

  const { data: inst, error: readError } = await supabase
    .from("loan_installments")
    .select("status, capital_amount")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    logger.error("loans.installment.read_failed", {
      userId: ctx.userId,
      id,
      error: readError,
    });
    return { ok: false, error: "No se pudo leer la cuota." };
  }
  if (!inst) return { ok: false, error: "No se encontró la cuota." };
  if (inst.status === "pagada") {
    return { ok: false, error: "No se puede editar una cuota ya pagada." };
  }
  // «Otros» of a cuota with charges is their sum: changing it would leave
  // them out of its entry.
  if (split) {
    const charges = await supabase
      .from("loan_installment_charges")
      .select("amount, iva_amount")
      .eq("installment_id", id)
      .limit(100);
    if (charges.error) {
      logger.error("loans.installment.charges_read_failed", {
        userId: ctx.userId,
        id,
        error: charges.error,
      });
      return { ok: false, error: "No se pudo leer la cuota." };
    }
    const chargesTotal =
      Math.round(
        charges.data.reduce(
          (s, c) => s + Number(c.amount) + Number(c.iva_amount),
          0,
        ) * 100,
      ) / 100;
    if (
      charges.data.length > 0 &&
      Math.abs(split.other - chargesTotal) > 0.005
    ) {
      return {
        ok: false,
        error: `«Otros» son los cargos de la cuota (${chargesTotal.toFixed(2)}): para cambiarlos cargá el resumen de cuota.`,
      };
    }
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
            iva_perception_amount: null,
            other_charges_amount: null,
          }
        : {
            amount: splitTotal(split),
            capital_amount: split.capital,
            interest_amount: split.interest,
            iva_amount: split.iva,
            perception_amount:
              Math.round((split.perception + split.iva_perception) * 100) / 100,
            iva_perception_amount: split.iva_perception || null,
            other_charges_amount: split.other,
          };

  // Guarded on what was read: a cuota paid meanwhile, or split meanwhile
  // while this edit changes its amount, is not overwritten.
  let update = supabase
    .from("loan_installments")
    .update({
      ...(rest.amount !== undefined && { amount: rest.amount }),
      ...(rest.due_date !== undefined && { due_date: rest.due_date }),
      ...(rest.notes !== undefined && { notes: rest.notes }),
      ...splitColumns,
    })
    .eq("id", id)
    .eq("status", inst.status);
  if (split === undefined && rest.amount !== undefined) {
    update = update.is("capital_amount", null);
  }
  const { data: updated, error } = await update.select("id");
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
  if (!updated || updated.length === 0) {
    return {
      ok: false,
      error: "La cuota cambió mientras la editabas. Recargá la página.",
    };
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
  if (!userCanAll(ctx.access, LOAN_CASH_PERMISSIONS)) {
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
  if (!userCanAll(ctx.access, LOAN_CASH_PERMISSIONS)) {
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
  if (!userCanAll(ctx.access, LOAN_CASH_PERMISSIONS)) {
    return { ok: false, error: "Sin permiso para registrar pagos." };
  }
  const parsed = PayInstallmentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  return payLoanInstallment(ctx.userId, parsed.data);
}

/** «Devolución de capital» of an open-ended loan: the capital (in the loan's
 *  currency) from an account, with the pesos that leave it when a USD loan
 *  is repaid from a peso account. */
export async function repayLoanCapitalAction(
  input: unknown,
): Promise<ActionResult<{ transactionId: string }>> {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, LOAN_CASH_PERMISSIONS)) {
    return { ok: false, error: "Sin permiso para registrar pagos." };
  }
  const parsed = RepayCapitalSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const d = parsed.data;
  const supabase = await createSupabaseClient();
  const { data: transactionId, error } = await supabase.rpc(
    "repay_loan_capital",
    {
      p_loan_id: d.loan_id,
      p_date: d.date,
      p_account_id: d.account_id,
      p_amount: d.amount,
      // A null p_account_amount is how the RPC reads «same currency».
      p_account_amount: d.account_amount ?? undefined,
    },
  );
  if (error || !transactionId) {
    const guardError = mapDbGuardError(error, {
      slug: "loans.capital_repay.rejected",
      userId: ctx.userId,
      id: d.loan_id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("loans.capital_repay.failed", {
      userId: ctx.userId,
      id: d.loan_id,
      error,
    });
    return {
      ok: false,
      error: "No se pudo registrar la devolución de capital.",
    };
  }
  await logAudit(
    "loan.capital_repaid",
    ctx.userId,
    {
      amount: d.amount,
      account_amount: d.account_amount ?? null,
      transaction_id: transactionId,
    },
    d.loan_id,
  );
  return { ok: true, data: { transactionId } };
}

/** The official USD rate on or before a date, to prefill «Cotización» when a
 *  USD cuota or capital is paid from a peso account; null = none loaded. */
export async function getOfficialUsdRateAction(
  date: string,
): Promise<ActionResult<UsdRate | null>> {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, LOAN_CASH_PERMISSIONS)) {
    return { ok: false, error: "Sin permiso para registrar pagos." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "Fecha inválida." };
  }
  const supabase = await createSupabaseClient();
  return { ok: true, data: await fetchUsdRateOnOrBefore(supabase, date) };
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
  const { data: cancelled, error } = await supabase
    .from("loans")
    .update({ status: "cancelled" })
    .eq("id", parsed.data.id)
    .neq("status", "cancelled")
    .select("id");
  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "loans.cancel.rejected",
      userId: ctx.userId,
      id: parsed.data.id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("loans.cancel.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo anular el préstamo." };
  }
  if (!cancelled || cancelled.length === 0) {
    return {
      ok: false,
      error: "El préstamo ya estaba anulado o no existe. Recargá la página.",
    };
  }
  await logAudit("loan.cancelled", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}
