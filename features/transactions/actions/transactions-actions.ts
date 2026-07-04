"use server";

import { logAudit } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import {
  isTransactionCurrency,
  isTransactionKind,
  TransactionCreateSchema,
  TransactionFiltersSchema,
  TransactionUpdateSchema,
  TransferCreateSchema,
  type Transaction,
  type TransactionFilters,
} from "../schema";

function narrowTransaction(row: {
  kind: string | null;
  currency: string | null;
  [key: string]: unknown;
}): Transaction | null {
  if (!isTransactionKind(row.kind)) {
    logger.error("transactions.unknown_kind", { value: row.kind });
    return null;
  }
  if (!isTransactionCurrency(row.currency)) {
    logger.error("transactions.unknown_currency", { value: row.currency });
    return null;
  }
  return row as Transaction;
}

const SELECT_COLUMNS =
  "id, account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description, invoice_id, counterparty_client_id, transfer_pair_id, created_by, created_at, updated_at";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface TransactionListItem extends Transaction {
  channel_name: string;
  channel_division: string;
  channel_is_fiscal: boolean;
  account_name: string;
  account_type: string;
  counterparty_legal_name: string | null;
}

export interface TransactionListPage {
  items: TransactionListItem[];
  nextOffset: number | null;
}

const DEFAULT_PAGE_SIZE = 50;

export async function listTransactionsAction(
  rawFilters: unknown = {},
): Promise<ActionResult<TransactionListPage>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "transactions:read")) {
    return { ok: false, error: "No tenés permiso para ver movimientos." };
  }

  const parsedFilters = TransactionFiltersSchema.safeParse(rawFilters);
  if (!parsedFilters.success) {
    return {
      ok: false,
      error: parsedFilters.error.issues[0]?.message ?? "Filtros inválidos.",
    };
  }
  const filters: TransactionFilters = parsedFilters.data;

  const offset = Math.max(0, filters.offset ?? 0);
  const limit = Math.min(200, Math.max(1, filters.limit ?? DEFAULT_PAGE_SIZE));

  const supabase = await createSupabaseClient();
  let query = supabase
    .from("v_transactions_tagged")
    .select(
      `${SELECT_COLUMNS}, channel_name, channel_division, channel_is_fiscal, account_name, account_type, counterparty_client:clients!transactions_counterparty_client_id_fkey ( legal_name )`,
      { count: "exact" },
    )
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false })
    // Tie-breaker: transfer_in + transfer_out share transaction_date and
    // created_at (inserted atomically in the same tx, now() returns the same).
    // Without ordering by id, pagination is non-deterministic and the same row can
    // appear on two pages → React duplicate key error.
    .order("id", { ascending: false });

  if (filters.channel_id) query = query.eq("channel_id", filters.channel_id);
  if (filters.account_id) query = query.eq("account_id", filters.account_id);
  if (filters.kind) query = query.eq("kind", filters.kind);
  if (filters.date_from)
    query = query.gte("transaction_date", filters.date_from);
  if (filters.date_to) query = query.lte("transaction_date", filters.date_to);
  if (filters.client_id)
    query = query.eq("counterparty_client_id", filters.client_id);

  query = query.range(offset, offset + limit);

  const { data, error } = await query;
  if (error) {
    logger.error("transactions.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar los movimientos." };
  }

  /** Extra columns from the `v_transactions_tagged` view + the `counterparty_client`
   *  join that aren't in Supabase's generated typing (views aren't generated). */
  type TaggedTransactionRow = {
    channel_name: string;
    channel_division: string;
    channel_is_fiscal: boolean;
    account_name: string;
    account_type: string;
    counterparty_client: { legal_name: string } | null;
  };

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const items = rows
    .slice(0, limit)
    .map((row) => {
      const narrowed = narrowTransaction(row);
      if (!narrowed) return null;
      const tagged = row as unknown as TaggedTransactionRow;
      return {
        ...narrowed,
        channel_name: tagged.channel_name,
        channel_division: tagged.channel_division,
        channel_is_fiscal: tagged.channel_is_fiscal,
        account_name: tagged.account_name,
        account_type: tagged.account_type,
        counterparty_legal_name: tagged.counterparty_client?.legal_name ?? null,
      };
    })
    .filter((item): item is TransactionListItem => item !== null);

  return {
    ok: true,
    data: { items, nextOffset: hasMore ? offset + limit : null },
  };
}

export async function getTransactionByIdAction(
  id: string,
): Promise<ActionResult<Transaction | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "transactions:read")) {
    return { ok: false, error: "No tenés permiso para ver movimientos." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("transactions")
    .select(SELECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    logger.error("transactions.get.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo cargar el movimiento." };
  }
  return { ok: true, data: data ? narrowTransaction(data) : null };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createTransactionAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "transactions:write")) {
    return { ok: false, error: "No tenés permiso para registrar movimientos." };
  }

  const parsed = TransactionCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const data = parsed.data;

  const supabase = await createSupabaseClient();

  // Accounts of type checks/echeq are handled exclusively from
  // /checks (manual entry, deposit, endorsement, crediting). We block
  // manual ins/outs against those accounts to avoid drift
  // between the check portfolio and the cash register.
  const { data: acc } = await supabase
    .from("accounts")
    .select("type")
    .eq("id", data.account_id)
    .maybeSingle();
  if (acc?.type === "checks" || acc?.type === "echeq") {
    return {
      ok: false,
      error:
        "Los movimientos en cuentas de cheques se manejan desde /checks (cargar, depositar, endosar).",
    };
  }

  const { data: row, error } = await supabase
    .from("transactions")
    .insert({
      account_id: data.account_id,
      channel_id: data.channel_id,
      kind: data.kind,
      amount: data.amount,
      currency: data.currency,
      transaction_date: data.transaction_date,
      accrual_month: data.accrual_month,
      description: data.description ?? null,
      invoice_id: data.invoice_id ?? null,
      counterparty_client_id: data.counterparty_client_id ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error) {
    logger.error("transactions.create.failed", { userId: ctx.userId, error });
    return {
      ok: false,
      error: error.message ?? "No se pudo registrar el movimiento.",
    };
  }

  await logAudit(
    "transaction.created",
    ctx.userId,
    {
      kind: data.kind,
      amount: data.amount,
      account_id: data.account_id,
      channel_id: data.channel_id,
    },
    row.id,
  );
  return { ok: true, data: { id: row.id } };
}

export async function createTransferAction(
  input: unknown,
): Promise<ActionResult<{ transfer_out_id: string; transfer_in_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "transactions:write")) {
    return { ok: false, error: "No tenés permiso para registrar movimientos." };
  }

  const parsed = TransferCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const data = parsed.data;

  const supabase = await createSupabaseClient();
  const { data: rows, error } = await supabase.rpc("create_transfer", {
    p_account_from_id: data.account_from_id,
    p_account_to_id: data.account_to_id,
    p_channel_id: data.channel_id,
    p_amount: data.amount,
    p_currency: data.currency,
    p_transaction_date: data.transaction_date,
    p_accrual_month: data.accrual_month,
    p_description: data.description ?? "",
  });

  if (error) {
    logger.error("transactions.create_transfer.failed", {
      userId: ctx.userId,
      error,
    });
    return {
      ok: false,
      error: error.message ?? "No se pudo registrar la transferencia.",
    };
  }

  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) {
    return { ok: false, error: "El RPC create_transfer no devolvió ids." };
  }

  await logAudit(
    "transaction.transfer_created",
    ctx.userId,
    {
      from: data.account_from_id,
      to: data.account_to_id,
      amount: data.amount,
      channel_id: data.channel_id,
    },
    row.transfer_out_id,
  );

  return {
    ok: true,
    data: {
      transfer_out_id: row.transfer_out_id as string,
      transfer_in_id: row.transfer_in_id as string,
    },
  };
}

export async function updateTransactionAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "transactions:write")) {
    return { ok: false, error: "No tenés permiso para editar movimientos." };
  }

  const parsed = TransactionUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const data = parsed.data;

  const supabase = await createSupabaseClient();

  // System-generated movements (receipt / payment order / transfer / invoice)
  // must not have their amount/date edited — the journal would drift out of sync
  // (the DB trigger enforces this too). Edit the source document instead.
  const { data: existing } = await supabase
    .from("transactions")
    .select("receipt_id, payment_order_id, transfer_pair_id, invoice_id")
    .eq("id", data.id)
    .maybeSingle();
  if (
    existing &&
    (existing.receipt_id ||
      existing.payment_order_id ||
      existing.transfer_pair_id ||
      existing.invoice_id)
  ) {
    return {
      ok: false,
      error:
        "Este movimiento fue generado por un recibo, orden de pago, transferencia o comprobante. Editá el documento de origen, no el movimiento.",
    };
  }

  const { error } = await supabase
    .from("transactions")
    .update({
      amount: data.amount,
      transaction_date: data.transaction_date,
      accrual_month: data.accrual_month,
      description: data.description ?? null,
      counterparty_client_id: data.counterparty_client_id ?? null,
    })
    .eq("id", data.id);

  if (error) {
    logger.error("transactions.update.failed", {
      userId: ctx.userId,
      id: data.id,
      error,
    });
    return {
      ok: false,
      error: error.message ?? "No se pudo actualizar el movimiento.",
    };
  }

  await logAudit(
    "transaction.updated",
    ctx.userId,
    { amount: data.amount },
    data.id,
  );
  return { ok: true, data: undefined };
}

export async function deleteTransactionAction(
  id: string,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  // Aligned with the transactions DELETE RLS (owner only); finance/operations
  // have transactions:write but the policy blocks them — clean gate here.
  if (!ctx.roles.includes("owner")) {
    return { ok: false, error: "Solo owner puede borrar movimientos." };
  }

  const supabase = await createSupabaseClient();
  // For a transfer pair, the FK on_delete cascade on transfer_pair_id wipes
  // the other half automatically — confirmed by the migration.
  const { error } = await supabase.from("transactions").delete().eq("id", id);

  if (error) {
    logger.error("transactions.delete.failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo borrar el movimiento." };
  }

  await logAudit("transaction.deleted", ctx.userId, {}, id);
  return { ok: true, data: undefined };
}
