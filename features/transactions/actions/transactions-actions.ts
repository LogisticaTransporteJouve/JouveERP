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
    // Tie-breaker: transfer_in + transfer_out comparten transaction_date y
    // created_at (insertados atomicamente en el mismo tx, now() devuelve igual).
    // Sin orden por id la paginación es no-determinística y el mismo row puede
    // aparecer en dos páginas → React duplicate key error.
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

  /** Columnas extra del view `v_transactions_tagged` + join `counterparty_client`
   *  que no están en el typing generado de Supabase (las views no se generan). */
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

  // Las cuentas tipo checks/echeq se manejan exclusivamente desde
  // /checks (carga manual, depósito, endoso, acreditación). Bloqueamos
  // ingresos/egresos manuales contra esos accounts para evitar drift
  // entre la cartera de cheques y la caja.
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
  if (!userCan(ctx.roles, "transactions:write")) {
    return { ok: false, error: "No tenés permiso para borrar movimientos." };
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
