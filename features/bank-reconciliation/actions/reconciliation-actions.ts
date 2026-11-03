"use server";

import { isAccountType, isCheckAccount } from "@/features/accounts/schema";
import { TransactionCreateSchema } from "@/features/transactions/schema";
import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import {
  matchBankLine,
  matchBankLines,
  type BankMatchesResult,
} from "@/lib/commands/match-bank-line";
import { addDaysIso } from "@/lib/date-range";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { fetchInChunks, paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import { suggestMatches, summarize } from "../lib/reconcile";
import {
  AcceptSuggestionsSchema,
  CANDIDATE_DAY_WINDOW,
  CreateLineTransactionSchema,
  IgnoreLineSchema,
  LineIdSchema,
  MatchLineSchema,
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
          "id, line_date, description, amount, balance, reference, status, ignore_reason, line_no, import_run_id, created_at",
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
          "id, transaction_date, kind, amount, description, source_document",
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
  const lineOfTx = new Map(byTx.data.map((m) => [m.transaction_id, m.line_id]));

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
            line_id: lineOfTx.get(t.id) ?? null,
          },
        ]
      : [],
  );

  // Book balance at the period's end: opening balance plus every movement up
  // to then (the treasury summary's own aggregate).
  const totals = await paginateRange((f, t) =>
    service
      .rpc("account_movement_totals", { p_until: to, p_split: from })
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
  const net = Number(totals.data[0]?.net_until ?? 0);
  const bookBalance =
    Math.round((Number(acc.data.opening_balance) + net) * 100) / 100;

  return {
    ok: true,
    data: {
      account,
      from,
      to,
      lines,
      movements,
      suggestions: suggestMatches(lines, movements, SUGGESTION_DAY_WINDOW),
      summary: summarize({ lines, movements, from, to, bookBalance }),
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

/** Back to pending: its movements can be edited again. */
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
  const { error } = await getServiceClient().rpc(
    "unmatch_bank_statement_line",
    {
      p_line_id: line_id,
      p_user_id: ctx.userId,
    },
  );
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
