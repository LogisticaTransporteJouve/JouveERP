"use server";

import { isAccountType, isCheckAccount } from "@/features/accounts/schema";
import { DepositChequeSchema } from "@/features/checks/schema";
import {
  TransactionCreateSchema,
  TransferCreateSchema,
} from "@/features/transactions/schema";
import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import {
  TREASURY_WRITE_PERMISSIONS,
  userCan,
  userCanAll,
} from "@/lib/auth/permissions";
import { CHECK_CASH_PERMISSIONS } from "@/features/checks/lib/check-cash";
import { ISSUED_CHECK_CASH_PERMISSIONS } from "@/features/issued-checks/lib/issued-check-cash";
import { LOAN_CASH_PERMISSIONS } from "@/features/loans/lib/loan-cash";
import { readCardPartDenied } from "@/lib/cards/card-part-access";
import { createTransfer } from "@/lib/commands/create-transfer";
import { creditCheck } from "@/lib/commands/credit-check";
import { depositCheck } from "@/lib/commands/deposit-check";
import { payLoanInstallment } from "@/lib/commands/pay-loan-installment";
import {
  matchBankLine,
  matchBankLines,
  type BankMatchesResult,
} from "@/lib/commands/match-bank-line";
import { readMainFiscalChannelId } from "@/lib/channels";
import { addDaysIso } from "@/lib/date-range";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { fetchInChunks, paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import {
  lastStatementBalance,
  suggestMatches,
  summarize,
} from "../lib/reconcile";
import {
  AcceptSuggestionsSchema,
  BANK_TAX_ROLES,
  CANDIDATE_DAY_WINDOW,
  CreateLineTaxPaymentSchema,
  CreateLineTransactionSchema,
  IgnoreLineSchema,
  LineIdSchema,
  MatchLineSchema,
  DebitIssuedCheckFromLineSchema,
  MatchLineToPaymentOrderSchema,
  MatchLineToReceiptSchema,
  PayCardFromLineSchema,
  TransferFromLineSchema,
  DepositCheckFromLineSchema,
  PayLoanFromLineSchema,
  MatchLinesToMovementSchema,
  ReconciliationQuerySchema,
  SUGGESTION_DAY_WINDOW,
  isStatementLineStatus,
  type BookMovement,
  type ReconciliationAccount,
  type ReconciliationView,
  type StatementLine,
} from "../schema";

const READ_DENIED = "No tenés permiso para ver la conciliación.";
const WRITE_DENIED = "No tenés permiso para conciliar.";
const cents = (n: number) => Math.round(n * 100);

/** The fiscal channel a bank line's movement goes to: the main app's (a
 *  segregated channel is never picked for a loose bank movement). */
async function fiscalChannel(
  service: ReturnType<typeof getServiceClient>,
  userId: string,
): Promise<ActionResult<string>> {
  const res = await readMainFiscalChannelId(service);
  if (!res.ok) {
    logger.error("reconciliation.channel.read_failed", { userId });
    return res;
  }
  return res.data
    ? { ok: true, data: res.data }
    : { ok: false, error: "No hay un canal fiscal activo." };
}

/** Rows one page reads; past this the period has to be narrowed. */
const MAX_ROWS = 20_000;

function signed(kind: string, amount: number): number {
  return kind === "income" || kind === "transfer_in" ? amount : -amount;
}

function narrowAccount(row: {
  id: string;
  name: string;
  type: string;
  currency: string;
}): ReconciliationAccount | null {
  const type = isAccountType(row.type) ? row.type : undefined;
  if (!type || isCheckAccount(type)) return null;
  if (row.currency !== "ARS" && row.currency !== "USD") return null;
  return { id: row.id, name: row.name, type, currency: row.currency };
}

/** The active accounts a statement can belong to (not the check carteras). */
export async function listReconciliationAccountsAction(): Promise<
  ActionResult<ReconciliationAccount[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "transactions:read")) {
    return { ok: false, error: READ_DENIED };
  }
  const { data, error } = await getServiceClient()
    .from("accounts")
    .select("id, name, type, currency")
    .eq("is_active", true)
    .order("name")
    .order("id");
  if (error) {
    logger.error("reconciliation.accounts.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudieron leer las cuentas." };
  }
  return { ok: true, data: data.flatMap((a) => narrowAccount(a) ?? []) };
}

type LineRow = {
  id: string;
  line_date: string;
  description: string;
  amount: number;
  balance: number | null;
  reference: string | null;
  bank_code: string | null;
  status: string;
  ignore_reason: string | null;
  line_no: number;
  import_run_id: string;
  created_at: string;
};

/**
 * Statement lines in the order the bank listed them: by date, then by
 * import, then by row of the file; a file listed newest first (its first row
 * dated after its last) is read backwards within a day.
 */
function chronological(rows: readonly LineRow[]): LineRow[] {
  const descending = new Map<string, boolean>();
  const byRun = new Map<string, LineRow[]>();
  for (const r of rows) {
    byRun.set(r.import_run_id, [...(byRun.get(r.import_run_id) ?? []), r]);
  }
  for (const [run, list] of byRun) {
    const sorted = [...list].sort((a, b) => a.line_no - b.line_no);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    descending.set(run, !!first && !!last && first.line_date > last.line_date);
  }
  return [...rows].sort((a, b) => {
    if (a.line_date !== b.line_date) return a.line_date < b.line_date ? -1 : 1;
    if (a.created_at !== b.created_at)
      return a.created_at < b.created_at ? -1 : 1;
    if (a.import_run_id !== b.import_run_id) {
      return a.import_run_id < b.import_run_id ? -1 : 1;
    }
    const sign = descending.get(a.import_run_id) ? -1 : 1;
    return sign * (a.line_no - b.line_no);
  });
}

/** The statement lines of an account and period, the account's movements
 *  around it, the suggested matches and the balances. */
export async function getReconciliationAction(
  input: unknown,
): Promise<ActionResult<ReconciliationView>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "transactions:read")) {
    return { ok: false, error: READ_DENIED };
  }
  const parsed = ReconciliationQuerySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { account_id, from, to } = parsed.data;
  const service = getServiceClient();

  const acc = await service
    .from("accounts")
    .select("id, name, type, currency, opening_balance")
    .eq("id", account_id)
    .maybeSingle();
  if (acc.error) {
    logger.error("reconciliation.account.failed", {
      userId: ctx.userId,
      error: acc.error,
    });
    return { ok: false, error: "No se pudo leer la cuenta." };
  }
  const account = acc.data ? narrowAccount(acc.data) : null;
  if (!acc.data || !account) {
    return { ok: false, error: "La cuenta no existe o no se concilia." };
  }

  const lineRes = await paginateRange(
    (f, t) =>
      service
        .from("bank_statement_lines")
        .select(
          "id, line_date, description, amount, balance, reference, bank_code, status, ignore_reason, line_no, import_run_id, created_at",
        )
        .eq("account_id", account_id)
        .gte("line_date", from)
        .lte("line_date", to)
        .order("line_date")
        .order("id")
        .range(f, t),
    undefined,
    MAX_ROWS,
  );
  const windowFrom = addDaysIso(from, -CANDIDATE_DAY_WINDOW);
  const windowTo = addDaysIso(to, CANDIDATE_DAY_WINDOW);
  const txRes = await paginateRange(
    (f, t) =>
      service
        .from("v_transactions_tagged")
        .select(
          "id, transaction_date, kind, amount, description, source_document, channel_id",
        )
        .eq("account_id", account_id)
        .gte("transaction_date", windowFrom)
        .lte("transaction_date", windowTo)
        .order("transaction_date")
        .order("id")
        .range(f, t),
    undefined,
    MAX_ROWS,
  );
  if (lineRes.error || txRes.error) {
    const capped =
      lineRes.error?.code === "row_cap" || txRes.error?.code === "row_cap";
    logger.error("reconciliation.read.failed", {
      userId: ctx.userId,
      account_id,
      error: lineRes.error ?? txRes.error,
    });
    return {
      ok: false,
      error: capped
        ? "El período tiene demasiados movimientos: acotalo."
        : "No se pudieron leer el extracto y los movimientos.",
    };
  }

  const lineIds = lineRes.data.map((l) => l.id);
  const txIds = txRes.data.flatMap((t) => (t.id ? [t.id] : []));
  const [byLine, byTx] = await Promise.all([
    fetchInChunks(lineIds, (chunk) =>
      service
        .from("bank_statement_matches")
        .select("line_id, transaction_id")
        .in("line_id", chunk),
    ),
    fetchInChunks(txIds, (chunk) =>
      service
        .from("bank_statement_matches")
        .select("line_id, transaction_id")
        .in("transaction_id", chunk),
    ),
  ]);
  if (byLine.error || byTx.error) {
    logger.error("reconciliation.matches.failed", {
      userId: ctx.userId,
      account_id,
      error: byLine.error ?? byTx.error,
    });
    return { ok: false, error: "No se pudo leer la conciliación." };
  }
  const txOfLine = new Map<string, string[]>();
  for (const m of byLine.data) {
    txOfLine.set(m.line_id, [
      ...(txOfLine.get(m.line_id) ?? []),
      m.transaction_id,
    ]);
  }
  const linesOfTx = new Map<string, string[]>();
  for (const m of byTx.data) {
    linesOfTx.set(m.transaction_id, [
      ...(linesOfTx.get(m.transaction_id) ?? []),
      m.line_id,
    ]);
  }

  const lines: StatementLine[] = chronological(lineRes.data).flatMap((l) => {
    if (!isStatementLineStatus(l.status)) {
      logger.warn("reconciliation.unknown_status", { id: l.id });
      return [];
    }
    return [
      {
        id: l.id,
        line_date: l.line_date,
        description: l.description,
        amount: Number(l.amount),
        balance: l.balance === null ? null : Number(l.balance),
        reference: l.reference,
        bank_code: l.bank_code,
        status: l.status,
        ignore_reason: l.ignore_reason,
        transaction_ids: txOfLine.get(l.id) ?? [],
      },
    ];
  });
  const movements: BookMovement[] = txRes.data.flatMap((t) =>
    t.id && t.transaction_date && t.kind && t.amount !== null
      ? [
          {
            id: t.id,
            transaction_date: t.transaction_date,
            kind: t.kind,
            signed_amount: signed(t.kind, Number(t.amount)),
            description: t.description,
            source_document: t.source_document,
            channel_id: t.channel_id,
            line_ids: linesOfTx.get(t.id) ?? [],
          },
        ]
      : [],
  );

  // Book balance at the period's end, and on the date of the statement's
  // last balance (what the difference compares): opening balance plus every
  // movement up to then (the treasury summary's own aggregate).
  const statementDate = lastStatementBalance(lines)?.line_date ?? to;
  const totals = await paginateRange((f, t) =>
    service
      .rpc("account_movement_totals", { p_until: to, p_split: statementDate })
      .eq("account_id", account_id)
      .order("account_id")
      .range(f, t),
  );
  if (totals.error) {
    logger.error("reconciliation.book_balance.failed", {
      userId: ctx.userId,
      account_id,
      error: totals.error,
    });
    return { ok: false, error: "No se pudo calcular el saldo según libros." };
  }
  const opening = Number(acc.data.opening_balance);
  const atCents = (net: unknown) =>
    Math.round((opening + Number(net ?? 0)) * 100) / 100;
  const bookBalance = atCents(totals.data[0]?.net_until);
  const bookBalanceAtStatement = atCents(totals.data[0]?.net_until_split);

  return {
    ok: true,
    data: {
      account,
      from,
      to,
      lines,
      movements,
      suggestions: suggestMatches(lines, movements, SUGGESTION_DAY_WINDOW),
      summary: summarize({
        lines,
        movements,
        from,
        to,
        bookBalance,
        bookBalanceAtStatement,
      }),
    },
  };
}

// ─── Writes ──────────────────────────────────────────────────────────────────

type RpcError = { message: string; code?: string; hint?: string } | null;

function rejected(
  error: RpcError,
  slug: string,
  userId: string,
  id: string,
  fallback: string,
): string {
  const guard = mapDbGuardError(error, { slug, userId, id });
  if (!guard)
    logger.error(slug.replace(".rejected", ".failed"), { userId, id, error });
  return guard ?? fallback;
}

/** Reconciles a line with movements of its account that add up to it. */
export async function matchLineAction(
  input: unknown,
): Promise<ActionResult<{ line_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "transactions:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = MatchLineSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  return matchBankLine(ctx.userId, parsed.data);
}

/** Reconciles a line with the movements of its account that a document
 *  created (the receipt or payment order issued from that line). */
async function matchLineToDocument(
  userId: string,
  lineId: string,
  column: "receipt_id" | "payment_order_id",
  documentId: string,
): Promise<ActionResult<{ line_id: string }>> {
  const what = column === "receipt_id" ? "del recibo" : "de la orden de pago";
  const service = getServiceClient();
  const line = await service
    .from("bank_statement_lines")
    .select("account_id")
    .eq("id", lineId)
    .maybeSingle();
  if (line.error || !line.data) {
    return { ok: false, error: "La línea del extracto ya no existe." };
  }
  const txs = await service
    .from("transactions")
    .select("id")
    .eq(column, documentId)
    .eq("account_id", line.data.account_id);
  if (txs.error) {
    logger.error("reconciliation.document_match.read_failed", {
      userId,
      column,
      error: txs.error,
    });
    return { ok: false, error: `No se pudo leer el movimiento ${what}.` };
  }
  if (txs.data.length === 0) {
    return {
      ok: false,
      error: `El movimiento ${what} no está en la cuenta del extracto.`,
    };
  }
  return matchBankLine(userId, {
    line_id: lineId,
    transaction_ids: txs.data.map((t) => t.id),
  });
}

export async function matchLineToReceiptAction(
  input: unknown,
): Promise<ActionResult<{ line_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "transactions:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = MatchLineToReceiptSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  return matchLineToDocument(
    ctx.userId,
    parsed.data.line_id,
    "receipt_id",
    parsed.data.receipt_id,
  );
}

export async function matchLineToPaymentOrderAction(
  input: unknown,
): Promise<ActionResult<{ line_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "transactions:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = MatchLineToPaymentOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  return matchLineToDocument(
    ctx.userId,
    parsed.data.line_id,
    "payment_order_id",
    parsed.data.payment_order_id,
  );
}

/** The bank outflow of an own cheque. A hand-loaded one writes it when
 *  cashed; one from a payment order has it in the order (a line of its
 *  amount in the account that no statement line explains yet). */
async function issuedCheckOutflow(
  service: ReturnType<typeof getServiceClient>,
  checkId: string,
  paymentOrderId: string | null,
  accountId: string,
  amount: number,
): Promise<string | null> {
  if (!paymentOrderId) {
    const own = await service
      .from("transactions")
      .select("id")
      .eq("issued_check_id", checkId)
      .eq("account_id", accountId)
      .limit(1);
    return own.error ? null : (own.data[0]?.id ?? null);
  }
  const order = await service
    .from("transactions")
    .select("id, amount")
    .eq("payment_order_id", paymentOrderId)
    .eq("account_id", accountId);
  if (order.error) return null;
  const candidates = order.data
    .filter((t) => cents(Number(t.amount)) === cents(amount))
    .map((t) => t.id);
  if (candidates.length === 0) return null;
  const taken = await service
    .from("bank_statement_matches")
    .select("transaction_id")
    .in("transaction_id", candidates);
  if (taken.error) return null;
  const used = new Set(taken.data.map((m) => m.transaction_id));
  return candidates.find((id) => !used.has(id)) ?? null;
}

/** An own cheque the bank debited: marked cashed on the line's date (which
 *  writes its outflow from the account) and the line reconciled with it. */
export async function debitIssuedCheckFromLineAction(
  input: unknown,
): Promise<ActionResult<{ line_id: string }>> {
  const ctx = await requireUserContext();
  // Like «Cobrado» in Cheques propios: the cheque and the treasury money.
  if (
    !userCan(ctx.access, "transactions:write") ||
    !userCanAll(ctx.access, ISSUED_CHECK_CASH_PERMISSIONS)
  ) {
    return {
      ok: false,
      error: "No tenés permiso para marcar cheques propios como cobrados.",
    };
  }
  const parsed = DebitIssuedCheckFromLineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const d = parsed.data;
  const service = getServiceClient();
  const [line, check] = await Promise.all([
    service
      .from("bank_statement_lines")
      .select("account_id, line_date, amount, status")
      .eq("id", d.line_id)
      .maybeSingle(),
    service
      .from("issued_checks")
      .select(
        "amount, check_number, bank_account_id, status, currency, payment_order_id",
      )
      .eq("id", d.issued_check_id)
      .maybeSingle(),
  ]);
  if (line.error || check.error) {
    logger.error("reconciliation.issued_check.read_failed", {
      userId: ctx.userId,
      error: line.error ?? check.error,
    });
    return { ok: false, error: "No se pudieron leer la línea y el cheque." };
  }
  if (!line.data || !check.data) {
    return { ok: false, error: "No se encontró la línea o el cheque." };
  }
  const l = line.data;
  const c = check.data;
  if (l.status !== "open" || Number(l.amount) >= 0) {
    return { ok: false, error: "La línea ya está resuelta o no es un débito." };
  }
  if (c.status !== "emitted") {
    return {
      ok: false,
      error: "El cheque ya no está emitido (se cobró, rechazó o anuló).",
    };
  }
  if (c.bank_account_id !== l.account_id || c.currency !== "ARS") {
    return { ok: false, error: "El cheque es de otra cuenta." };
  }
  if (cents(Number(c.amount)) !== cents(-Number(l.amount))) {
    return { ok: false, error: "El cheque no es del importe de la línea." };
  }
  // Only an emitted cheque moves, so a repeated click cannot cash it twice.
  const cashed = await service
    .from("issued_checks")
    .update({ status: "cashed", cashed_at: l.line_date })
    .eq("id", d.issued_check_id)
    .eq("status", "emitted")
    .select("id");
  if (cashed.error) {
    const guardError = mapDbGuardError(cashed.error, {
      slug: "reconciliation.issued_check.cash_rejected",
      userId: ctx.userId,
      id: d.issued_check_id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("reconciliation.issued_check.cash_failed", {
      userId: ctx.userId,
      error: cashed.error,
    });
    return { ok: false, error: "No se pudo marcar el cheque como cobrado." };
  }
  if (!cashed.data || cashed.data.length === 0) {
    return {
      ok: false,
      error: "El cheque ya no está emitido (se cobró, rechazó o anuló).",
    };
  }
  await logAudit(
    "issued_check.cashed",
    ctx.userId,
    { event_date: l.line_date, from: "bank_statement" },
    d.issued_check_id,
  );
  const txId = await issuedCheckOutflow(
    service,
    d.issued_check_id,
    c.payment_order_id,
    l.account_id,
    Number(c.amount),
  );
  if (!txId) {
    return {
      ok: false,
      error:
        "Se marcó el cheque como cobrado, pero no se encontró su movimiento en el banco: conciliá la línea con él.",
    };
  }
  const matched = await matchBankLine(ctx.userId, {
    line_id: d.line_id,
    transaction_ids: [txId],
  });
  if (!matched.ok) {
    return {
      ok: false,
      error: `Se marcó el cheque como cobrado, pero la línea no se concilió: ${matched.error}`,
    };
  }
  return { ok: true, data: { line_id: d.line_id } };
}

/** A cartera cheque the bank credited: deposited into the line's account on
 *  its date, the line reconciled with the bank's side, then credited. */
export async function depositCheckFromLineAction(
  input: unknown,
): Promise<ActionResult<{ line_id: string }>> {
  const ctx = await requireUserContext();
  // Like «Depositar» in Cheques: the cheque and the treasury money.
  if (
    !userCanAll(ctx.access, TREASURY_WRITE_PERMISSIONS) ||
    !userCanAll(ctx.access, CHECK_CASH_PERMISSIONS)
  ) {
    return { ok: false, error: "No tenés permiso para depositar cheques." };
  }
  const parsed = DepositCheckFromLineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const d = parsed.data;
  const service = getServiceClient();
  const [line, check, channel] = await Promise.all([
    service
      .from("bank_statement_lines")
      .select("account_id, line_date, amount, status")
      .eq("id", d.line_id)
      .maybeSingle(),
    service
      .from("checks")
      .select("amount, check_number, channel_id")
      .eq("id", d.check_id)
      .maybeSingle(),
    fiscalChannel(service, ctx.userId),
  ]);
  if (line.error || check.error) {
    logger.error("reconciliation.deposit.read_failed", {
      userId: ctx.userId,
      error: line.error ?? check.error,
    });
    return { ok: false, error: "No se pudieron leer la línea y el cheque." };
  }
  if (!line.data || !check.data) {
    return { ok: false, error: "No se encontró la línea o el cheque." };
  }
  // A cheque is deposited in its own channel (deposit_check refuses
  // another); one without a channel goes to the fiscal channel.
  let channelId: string;
  if (check.data.channel_id) channelId = check.data.channel_id;
  else if (channel.ok) channelId = channel.data;
  else return channel;
  const l = line.data;
  if (l.status !== "open" || Number(l.amount) <= 0) {
    return {
      ok: false,
      error: "La línea ya está resuelta o no es un crédito.",
    };
  }
  if (cents(Number(check.data.amount)) !== cents(Number(l.amount))) {
    return { ok: false, error: "El cheque no es del importe de la línea." };
  }
  const deposit = DepositChequeSchema.safeParse({
    check_id: d.check_id,
    account_id: l.account_id,
    event_date: l.line_date,
    channel_id: channelId,
    description: `Depósito cheque ${check.data.check_number}`,
  });
  if (!deposit.success) return { ok: false, error: "Datos inválidos." };
  const deposited = await depositCheck(ctx.userId, deposit.data);
  if (!deposited.ok) return deposited;
  // The deposit's movement is the cartera's side; the bank's is its pair.
  const movement = await service
    .from("check_movements")
    .select("transaction:transactions ( transfer_pair_id )")
    .eq("id", deposited.data.movement_id)
    .maybeSingle();
  if (movement.error) {
    logger.error("reconciliation.deposit.movement_read_failed", {
      userId: ctx.userId,
      error: movement.error,
    });
  }
  const tx = movement.data?.transaction;
  const pair = (Array.isArray(tx) ? tx[0] : tx)?.transfer_pair_id ?? null;
  if (!pair) {
    return {
      ok: false,
      error:
        "Se depositó el cheque, pero no se encontró su movimiento en el banco: conciliá la línea con él.",
    };
  }
  const matched = await matchBankLine(ctx.userId, {
    line_id: d.line_id,
    transaction_ids: [pair],
  });
  if (!matched.ok) {
    return {
      ok: false,
      error: `Se depositó el cheque, pero la línea no se concilió: ${matched.error}`,
    };
  }
  const credited = await creditCheck(ctx.userId, {
    check_id: d.check_id,
    event_date: l.line_date,
    notes: "Acreditado según el extracto del banco",
  });
  if (!credited.ok) {
    return {
      ok: false,
      error: `Se depositó y concilió el cheque, pero no se acreditó: acreditalo en Cheques (${credited.error}).`,
    };
  }
  return { ok: true, data: { line_id: d.line_id } };
}

/** A transfer between two accounts of the company, from one of its statement
 *  lines: both legs on the line's date (or the transfer already booked and
 *  not reconciled, when there is one), this line reconciled with its leg,
 *  and the other account's opposite line (same amount, up to 3 days apart)
 *  with the other leg when its statement is loaded. */
export async function transferFromLineAction(
  input: unknown,
): Promise<ActionResult<{ other: "matched" | "none" | "several" }>> {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, TREASURY_WRITE_PERMISSIONS)) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = TransferFromLineSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const d = parsed.data;
  const service = getServiceClient();
  const [line, accounts, channel] = await Promise.all([
    service
      .from("bank_statement_lines")
      .select("account_id, line_date, amount, status, description")
      .eq("id", d.line_id)
      .maybeSingle(),
    service.from("accounts").select("id, currency"),
    fiscalChannel(service, ctx.userId),
  ]);
  if (line.error) {
    logger.error("reconciliation.transfer.read_failed", {
      userId: ctx.userId,
      error: line.error,
    });
    return { ok: false, error: "No se pudo leer la línea del extracto." };
  }
  if (!line.data) {
    return { ok: false, error: "La línea del extracto ya no existe." };
  }
  if (accounts.error) {
    logger.error("reconciliation.transfer.read_failed", {
      userId: ctx.userId,
      error: accounts.error,
    });
    return { ok: false, error: "No se pudieron leer las cuentas." };
  }
  if (!channel.ok) return channel;
  const l = line.data;
  if (l.status !== "open") {
    return { ok: false, error: "La línea ya está resuelta." };
  }
  const own = accounts.data.find((a) => a.id === l.account_id);
  const other = accounts.data.find((a) => a.id === d.other_account_id);
  if (!own || !other || own.currency !== other.currency) {
    return {
      ok: false,
      error: "Las dos cuentas tienen que ser de la misma moneda.",
    };
  }
  const amount = Math.abs(Number(l.amount));
  const outgoing = Number(l.amount) < 0;

  // A transfer already booked between the two accounts (a retry after a
  // failed match, one loaded by hand, or one booked from the other
  // account's line, up to 3 days apart) is this one: reuse the closest.
  const legs = await service
    .from("transactions")
    .select(
      "id, transaction_date, transfer_pair_id, bank_statement_matches ( id )",
    )
    .eq("account_id", l.account_id)
    .eq("kind", outgoing ? "transfer_out" : "transfer_in")
    .eq("amount", amount)
    .gte("transaction_date", addDaysIso(l.line_date, -3))
    .lte("transaction_date", addDaysIso(l.line_date, 3))
    .not("transfer_pair_id", "is", null)
    .limit(20);
  const free = (legs.data ?? []).filter(
    (leg) => leg.bank_statement_matches.length === 0,
  );
  const pairs =
    free.length > 0
      ? await service
          .from("transactions")
          .select("id, bank_statement_matches ( id )")
          .eq("account_id", d.other_account_id)
          .in(
            "id",
            free.flatMap((leg) => leg.transfer_pair_id ?? []),
          )
      : {
          data: [] as {
            id: string;
            bank_statement_matches: { id: string }[];
          }[],
          error: null,
        };
  if (legs.error || pairs.error) {
    logger.error("reconciliation.transfer.read_failed", {
      userId: ctx.userId,
      error: legs.error ?? pairs.error,
    });
    return { ok: false, error: "No se pudieron leer los movimientos." };
  }
  const theirSide = new Set(pairs.data.map((p) => p.id));
  // The other account's leg of a reused transfer may be reconciled already
  // (its statement came first).
  const theirsMatched = new Set(
    pairs.data
      .filter((p) => p.bank_statement_matches.length > 0)
      .map((p) => p.id),
  );
  const away = (date: string) =>
    Math.abs(Date.parse(date) - Date.parse(l.line_date));
  const reuse = free
    .filter(
      (leg) => leg.transfer_pair_id && theirSide.has(leg.transfer_pair_id),
    )
    .sort((a, b) => away(a.transaction_date) - away(b.transaction_date))[0];
  let mine: string | null = reuse?.id ?? null;
  let theirs: string | null = reuse?.transfer_pair_id ?? null;
  if (!mine || !theirs) {
    const draft = TransferCreateSchema.safeParse({
      account_from_id: outgoing ? l.account_id : d.other_account_id,
      account_to_id: outgoing ? d.other_account_id : l.account_id,
      channel_id: channel.data,
      amount,
      currency: own.currency,
      transaction_date: l.line_date,
      accrual_month: `${l.line_date.slice(0, 7)}-01`,
      description: l.description.slice(0, 200),
    });
    if (!draft.success) {
      return {
        ok: false,
        error: draft.error.issues[0]?.message ?? "Datos inválidos.",
      };
    }
    const created = await createTransfer(ctx.userId, draft.data);
    if (!created.ok) return created;
    mine = outgoing
      ? created.data.transfer_out_id
      : created.data.transfer_in_id;
    theirs = outgoing
      ? created.data.transfer_in_id
      : created.data.transfer_out_id;
  }
  const matched = await matchBankLine(ctx.userId, {
    line_id: d.line_id,
    transaction_ids: [mine],
  });
  if (!matched.ok) {
    return {
      ok: false,
      error: `Se registró la transferencia, pero la línea no se concilió: ${matched.error}`,
    };
  }

  // The other account's side of it, when its statement is loaded.
  if (theirsMatched.has(theirs)) {
    return { ok: true, data: { other: "matched" } };
  }
  const opposite = await service
    .from("bank_statement_lines")
    .select("id")
    .eq("account_id", d.other_account_id)
    .eq("status", "open")
    .eq("amount", outgoing ? amount : -amount)
    .gte("line_date", addDaysIso(l.line_date, -3))
    .lte("line_date", addDaysIso(l.line_date, 3))
    .limit(2);
  if (opposite.error) {
    logger.error("reconciliation.transfer.opposite_failed", {
      userId: ctx.userId,
      error: opposite.error,
    });
  }
  // Unknown (the read failed) or ambiguous: the user reconciles it there.
  if (opposite.error || opposite.data.length > 1) {
    return { ok: true, data: { other: "several" } };
  }
  if (opposite.data.length === 0) return { ok: true, data: { other: "none" } };
  const res = await matchBankLine(ctx.userId, {
    line_id: opposite.data[0]!.id,
    transaction_ids: [theirs],
  });
  return { ok: true, data: { other: res.ok ? "matched" : "several" } };
}

/** Pays a card statement (its pesos or its dollars) with the bank's debit:
 *  its expenses and salary advances are booked on the account on the
 *  debit's date and the line is reconciled with them. */
export async function payCardStatementFromLineAction(
  input: unknown,
): Promise<ActionResult<{ movements: number }>> {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, TREASURY_WRITE_PERMISSIONS)) {
    return { ok: false, error: "No tenés permiso para pagar tarjetas." };
  }
  const parsed = PayCardFromLineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const d = parsed.data;
  const service = getServiceClient();
  const access = await readCardPartDenied(
    service,
    ctx.access,
    { statement_id: d.statement_id, currency: d.currency },
    BANK_TAX_ROLES,
    ctx.userId,
  );
  if (!access.ok) return { ok: false, error: "No se pudo leer el resumen." };
  const denied = access.denied;
  if (denied) return { ok: false, error: denied };
  const channel = await fiscalChannel(service, ctx.userId);
  if (!channel.ok) return channel;
  const { data, error } = await service.rpc("settle_card_statement", {
    p_statement_id: d.statement_id,
    p_line_id: d.line_id,
    p_currency: d.currency,
    p_channel_id: channel.data,
    p_user_id: ctx.userId,
  });
  if (error || data === null) {
    const guard = mapDbGuardError(error, {
      slug: "cards.settle.rejected",
      userId: ctx.userId,
    });
    if (guard) return { ok: false, error: guard };
    logger.error("cards.settle_failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo pagar el resumen." };
  }
  await logAudit(
    "card_statement.paid",
    ctx.userId,
    { line_id: d.line_id, currency: d.currency, movements: data },
    d.statement_id,
  );
  return { ok: true, data: { movements: data } };
}

/** Pays a loan cuota with a bank debit line and reconciles them: the cuota's
 *  outflow goes to the line's account on its date, for its amount. */
export async function payLoanInstallmentFromLineAction(
  input: unknown,
): Promise<ActionResult<{ line_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, LOAN_CASH_PERMISSIONS)) {
    return {
      ok: false,
      error: "No tenés permiso para pagar cuotas de préstamos.",
    };
  }
  const parsed = PayLoanFromLineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const line = await getServiceClient()
    .from("bank_statement_lines")
    .select("account_id, line_date, amount, status")
    .eq("id", parsed.data.line_id)
    .maybeSingle();
  if (line.error || !line.data) {
    return { ok: false, error: "La línea del extracto ya no existe." };
  }
  if (line.data.status !== "open" || Number(line.data.amount) >= 0) {
    return {
      ok: false,
      error: "La línea ya está resuelta o no es un débito.",
    };
  }
  const debit = -Number(line.data.amount);
  const split = parsed.data.split;
  if (split) {
    const parts =
      Math.round(
        (split.capital +
          split.interest +
          split.late_interest +
          split.iva +
          split.taxes +
          split.iva_perception) *
          100,
      ) / 100;
    if (Math.abs(parts - debit) > 0.005) {
      return {
        ok: false,
        error: `El desglose suma ${parts.toFixed(2)} y el débito es ${debit.toFixed(2)}.`,
      };
    }
    // The cuota takes what the bank actually applied before it is paid:
    // interest and punitorios to interest, taxes to perceptions (their total,
    // and apart its IVA part).
    const { error } = await getServiceClient()
      .from("loan_installments")
      .update({
        amount: debit,
        capital_amount: split.capital,
        interest_amount: split.interest,
        other_charges_amount: split.late_interest,
        iva_amount: split.iva,
        perception_amount:
          Math.round((split.taxes + split.iva_perception) * 100) / 100,
        iva_perception_amount: split.iva_perception || null,
      })
      .eq("id", parsed.data.installment_id)
      .eq("status", "pendiente");
    if (error) {
      const guard = mapDbGuardError(error, {
        slug: "reconciliation.loan_split.rejected",
        userId: ctx.userId,
      });
      if (!guard) {
        logger.error("reconciliation.loan_split.failed", {
          userId: ctx.userId,
          error,
        });
      }
      return { ok: false, error: guard ?? "No se pudo ajustar la cuota." };
    }
  }
  const paid = await payLoanInstallment(ctx.userId, {
    id: parsed.data.installment_id,
    paid_date: line.data.line_date,
    account_id: line.data.account_id,
    amount: debit,
  });
  if (!paid.ok) return paid;
  const matched = await matchBankLine(ctx.userId, {
    line_id: parsed.data.line_id,
    transaction_ids: [paid.data.transactionId],
  });
  if (!matched.ok) {
    return {
      ok: false,
      error: `La cuota quedó pagada pero la línea no se concilió: ${matched.error}`,
    };
  }
  return matched;
}

export type AcceptSuggestionsResult = BankMatchesResult;

/** Accepts several suggestions; each line is matched on its own, so one that
 *  went stale does not undo the others. */
export async function acceptSuggestionsAction(
  input: unknown,
): Promise<ActionResult<AcceptSuggestionsResult>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "transactions:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = AcceptSuggestionsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  return {
    ok: true,
    data: await matchBankLines(ctx.userId, parsed.data.matches),
  };
}

/** Several lines the bank split one movement into, matched with it when
 *  they add up to its signed amount. A retry of the same match is a no-op. */
export async function matchLinesToMovementAction(
  input: unknown,
): Promise<ActionResult<{ transaction_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "transactions:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = MatchLinesToMovementSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { line_ids, transaction_id } = parsed.data;
  const { error } = await getServiceClient().rpc("match_bank_statement_lines", {
    p_line_ids: line_ids,
    p_transaction_id: transaction_id,
    p_user_id: ctx.userId,
  });
  if (error) {
    return {
      ok: false,
      error: rejected(
        error,
        "reconciliation.match_lines.rejected",
        ctx.userId,
        transaction_id,
        "No se pudieron conciliar las líneas.",
      ),
    };
  }
  for (const lineId of line_ids) {
    await logAudit(
      "bank_statement_line.matched",
      ctx.userId,
      { transaction_ids: [transaction_id], split: true },
      lineId,
    );
  }
  return { ok: true, data: { transaction_id } };
}

/** Back to pending with the rest of its reconciliation (the other lines of
 *  a split movement): its movements can be edited again. A card statement's
 *  debit is refused: it is undone with its statement. */
export async function unmatchLineAction(
  input: unknown,
): Promise<ActionResult<{ line_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "transactions:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = LineIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { line_id } = parsed.data;
  const service = getServiceClient();
  // Unmatched here, its movements would stay and the statement stay paid.
  const card = await service
    .from("card_statement_lines")
    .select(
      "id, transactions!inner ( bank_statement_matches!inner ( line_id ) )",
    )
    .eq("transactions.bank_statement_matches.line_id", line_id)
    .limit(1);
  if (card.error) {
    logger.error("reconciliation.unmatch.card_read_failed", {
      userId: ctx.userId,
      lineId: line_id,
      error: card.error,
    });
    return { ok: false, error: "No se pudo desconciliar la línea." };
  }
  if (card.data.length > 0) {
    return {
      ok: false,
      error:
        "Esta línea pagó un resumen de tarjeta: deshacé el pago desde Tesorería › Tarjetas.",
    };
  }
  const { error } = await service.rpc("unmatch_bank_statement_line", {
    p_line_id: line_id,
    p_user_id: ctx.userId,
  });
  if (error) {
    return {
      ok: false,
      error: rejected(
        error,
        "reconciliation.unmatch.rejected",
        ctx.userId,
        line_id,
        "No se pudo desconciliar la línea.",
      ),
    };
  }
  await logAudit("bank_statement_line.unmatched", ctx.userId, {}, line_id);
  return { ok: true, data: { line_id } };
}

/** Marks a pending line "no corresponde", with its reason. */
export async function ignoreLineAction(
  input: unknown,
): Promise<ActionResult<{ line_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "transactions:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = IgnoreLineSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { line_id, reason } = parsed.data;
  const { error } = await getServiceClient().rpc(
    "set_bank_statement_line_ignored",
    { p_line_id: line_id, p_reason: reason, p_user_id: ctx.userId },
  );
  if (error) {
    return {
      ok: false,
      error: rejected(
        error,
        "reconciliation.ignore.rejected",
        ctx.userId,
        line_id,
        "No se pudo marcar la línea.",
      ),
    };
  }
  await logAudit(
    "bank_statement_line.ignored",
    ctx.userId,
    { reason },
    line_id,
  );
  return { ok: true, data: { line_id } };
}

/** Puts a "no corresponde" line back to pending. */
export async function restoreLineAction(
  input: unknown,
): Promise<ActionResult<{ line_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "transactions:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = LineIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { line_id } = parsed.data;
  const { error } = await getServiceClient().rpc(
    "set_bank_statement_line_ignored",
    { p_line_id: line_id, p_reason: "", p_user_id: ctx.userId },
  );
  if (error) {
    return {
      ok: false,
      error: rejected(
        error,
        "reconciliation.restore.rejected",
        ctx.userId,
        line_id,
        "No se pudo volver la línea a pendiente.",
      ),
    };
  }
  await logAudit("bank_statement_line.restored", ctx.userId, {}, line_id);
  return { ok: true, data: { line_id } };
}

/**
 * The movement the books lack for a line (a bank fee, interest, a debit
 * nobody loaded), created as the manual form creates one — income for a
 * credit, expense with its expense account for a debit, on the line's date
 * and account — and reconciled with the line in the same transaction.
 */
export async function createLineTransactionAction(
  input: unknown,
): Promise<ActionResult<{ transaction_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "transactions:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = CreateLineTransactionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const d = parsed.data;
  const service = getServiceClient();
  const line = await service
    .from("bank_statement_lines")
    .select("id, account_id, line_date, description, amount, status")
    .eq("id", d.line_id)
    .maybeSingle();
  if (line.error) {
    logger.error("reconciliation.create.read_failed", {
      userId: ctx.userId,
      id: d.line_id,
      error: line.error,
    });
    return { ok: false, error: "No se pudo leer la línea." };
  }
  if (!line.data) return { ok: false, error: "La línea no existe." };
  const acc = await service
    .from("accounts")
    .select("currency")
    .eq("id", line.data.account_id)
    .maybeSingle();
  if (acc.error || !acc.data) {
    return { ok: false, error: "No se pudo leer la cuenta." };
  }
  const amount = Number(line.data.amount);
  const isDebit = amount < 0;
  if (isDebit && !d.expense_account_id) {
    return { ok: false, error: "Elegí la cuenta de gasto del débito." };
  }
  const expenseAccountId = isDebit ? (d.expense_account_id ?? null) : null;
  if (expenseAccountId) {
    const target = await service
      .from("chart_of_accounts")
      .select("system_role")
      .eq("id", expenseAccountId)
      .maybeSingle();
    if (target.error) {
      return { ok: false, error: "No se pudo leer la cuenta contable." };
    }
    const role = target.data?.system_role;
    if (
      role &&
      (BANK_TAX_ROLES as readonly string[]).includes(role) &&
      !userCan(ctx.access, "taxes:write")
    ) {
      return {
        ok: false,
        error: "No tenés permiso para registrar impuestos.",
      };
    }
  }
  const costCenterId = isDebit ? (d.cost_center_id ?? null) : null;
  // The same contract as the manual form (Caja › Nuevo movimiento).
  const contract = TransactionCreateSchema.safeParse({
    account_id: line.data.account_id,
    channel_id: d.channel_id,
    kind: isDebit ? "expense" : "income",
    amount: Math.abs(amount),
    currency: acc.data.currency,
    transaction_date: line.data.line_date,
    accrual_month: `${line.data.line_date.slice(0, 7)}-01`,
    description: d.description ?? line.data.description,
    expense_account_id: expenseAccountId,
    cost_center_id: costCenterId,
  });
  if (!contract.success) {
    return {
      ok: false,
      error: contract.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const { data: txId, error } = await service.rpc(
    "create_bank_statement_line_transaction",
    {
      p_line_id: d.line_id,
      p_channel_id: d.channel_id,
      p_expense_account_id: expenseAccountId ?? undefined,
      p_cost_center_id: costCenterId ?? undefined,
      p_description: d.description ?? line.data.description,
      p_user_id: ctx.userId,
    },
  );
  if (error || !txId) {
    return {
      ok: false,
      error: rejected(
        error,
        "reconciliation.create.rejected",
        ctx.userId,
        d.line_id,
        "No se pudo crear el movimiento.",
      ),
    };
  }
  await logAudit(
    "transaction.created",
    ctx.userId,
    {
      kind: isDebit ? "expense" : "income",
      amount: Math.abs(amount),
      account_id: line.data.account_id,
      channel_id: d.channel_id,
      expense_account_id: expenseAccountId,
      cost_center_id: costCenterId,
      bank_statement_line_id: d.line_id,
    },
    txId,
  );
  await logAudit(
    "bank_statement_line.matched",
    ctx.userId,
    { transaction_ids: [txId], created: true },
    d.line_id,
  );
  return { ok: true, data: { transaction_id: txId } };
}

/**
 * A debit line the books lack, booked as the payment of a tax document:
 * pay_tax_document on the line's date, account and amount (an expense of
 * the fiscal channel owned by the document, its entry debiting the
 * document's account), reconciled with the line in the same transaction.
 */
export async function createLineTaxPaymentAction(
  input: unknown,
): Promise<ActionResult<{ transaction_id: string }>> {
  const ctx = await requireUserContext();
  if (
    !userCan(ctx.access, "transactions:write") ||
    !userCan(ctx.access, "taxes:write")
  ) {
    return {
      ok: false,
      error: "No tenés permiso para registrar el pago de un impuesto.",
    };
  }
  const parsed = CreateLineTaxPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { line_id, tax_document_id, allow_difference } = parsed.data;
  const { data: txId, error } = await getServiceClient().rpc(
    "create_bank_statement_line_tax_payment",
    {
      p_line_id: line_id,
      p_tax_document_id: tax_document_id,
      p_user_id: ctx.userId,
      p_allow_difference: allow_difference,
    },
  );
  if (error || !txId) {
    return {
      ok: false,
      error: rejected(
        error,
        "reconciliation.tax_payment.rejected",
        ctx.userId,
        line_id,
        "No se pudo registrar el pago del impuesto.",
      ),
    };
  }
  await logAudit(
    "tax_document.paid",
    ctx.userId,
    { transaction_id: txId, bank_statement_line_id: line_id, allow_difference },
    tax_document_id,
  );
  await logAudit(
    "bank_statement_line.matched",
    ctx.userId,
    { transaction_ids: [txId], created: true, tax_document_id },
    line_id,
  );
  return { ok: true, data: { transaction_id: txId } };
}
