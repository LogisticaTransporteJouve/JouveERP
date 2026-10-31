"use server";

import { logAudit } from "@/lib/actions/audit";
import type { JsonValue } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { paginateRange } from "@/lib/supabase/paginate";

import {
  AccountCreateSchema,
  AccountOpeningBalanceInputSchema,
  AccountToggleActiveSchema,
  AccountUpdateSchema,
  isAccountCurrency,
  isAccountType,
  type Account,
  type AccountOpeningBalanceInput,
} from "../schema";

function narrowAccount(row: {
  type: string;
  currency: string;
  [key: string]: unknown;
}): Account | null {
  if (!isAccountType(row.type)) {
    logger.error("accounts.unknown_type", { value: row.type });
    return null;
  }
  if (!isAccountCurrency(row.currency)) {
    logger.error("accounts.unknown_currency", { value: row.currency });
    return null;
  }
  return row as Account;
}

const SELECT_COLUMNS =
  "id, name, type, currency, opening_balance, notes, is_active, created_by, created_at, updated_at";

export async function listAccountsAction(): Promise<ActionResult<Account[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounts:read")) {
    return { ok: false, error: "No tenés permiso para ver cuentas." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await paginateRange((from, to) =>
    supabase
      .from("accounts")
      .select(SELECT_COLUMNS)
      .order("is_active", { ascending: false })
      .order("name")
      .order("id")
      .range(from, to),
  );

  if (error) {
    logger.error("accounts.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar las cuentas." };
  }

  const accounts = (data ?? [])
    .map((row) => narrowAccount(row))
    .filter((row): row is Account => row !== null);

  return { ok: true, data: accounts };
}

export async function createAccountAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounts:write")) {
    return { ok: false, error: "No tenés permiso para crear cuentas." };
  }

  const parsed = AccountCreateSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Datos inválidos.";
    return { ok: false, error: first };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("accounts")
    .insert({
      name: parsed.data.name,
      type: parsed.data.type,
      currency: parsed.data.currency,
      opening_balance: parsed.data.opening_balance,
      notes: parsed.data.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "Ya existe una cuenta con ese nombre, tipo y moneda.",
      };
    }
    logger.error("accounts.create.failed", {
      userId: ctx.userId,
      name: parsed.data.name,
      type: parsed.data.type,
      error,
    });
    return { ok: false, error: "No se pudo crear la cuenta." };
  }

  await logAudit(
    "account.created",
    ctx.userId,
    {
      name: parsed.data.name,
      type: parsed.data.type,
      currency: parsed.data.currency,
    },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updateAccountAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounts:write")) {
    return { ok: false, error: "No tenés permiso para editar cuentas." };
  }

  const parsed = AccountUpdateSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Datos inválidos.";
    return { ok: false, error: first };
  }

  const { id, ...rest } = parsed.data;

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("accounts")
    .update({
      ...(rest.name !== undefined && { name: rest.name }),
      ...(rest.type !== undefined && { type: rest.type }),
      ...(rest.currency !== undefined && { currency: rest.currency }),
      ...(rest.opening_balance !== undefined && {
        opening_balance: rest.opening_balance,
      }),
      ...(rest.notes !== undefined && { notes: rest.notes ?? null }),
    })
    .eq("id", id);

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "Ya existe una cuenta con ese nombre, tipo y moneda.",
      };
    }
    logger.error("accounts.update.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo actualizar la cuenta." };
  }

  await logAudit(
    "account.updated",
    ctx.userId,
    { fields: Object.keys(rest) as JsonValue[] },
    id,
  );
  return { ok: true, data: undefined };
}

export async function setAccountActiveAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounts:write")) {
    return { ok: false, error: "No tenés permiso para editar cuentas." };
  }

  const parsed = AccountToggleActiveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." };
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("accounts")
    .update({ is_active: parsed.data.is_active })
    .eq("id", parsed.data.id);

  if (error) {
    logger.error("accounts.toggle_active.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      is_active: parsed.data.is_active,
      error,
    });
    return { ok: false, error: "No se pudo cambiar el estado de la cuenta." };
  }

  await logAudit(
    parsed.data.is_active ? "account.reactivated" : "account.deactivated",
    ctx.userId,
    {},
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Opening balance (account balance adjustment)
// ---------------------------------------------------------------------------

export interface AccountOpeningBalance {
  account_id: string;
  adjustment_date: string;
  target_balance: number;
  adjustment_transaction_id: string | null;
  /** Channel of the adjustment movement; null when there is none. */
  channel_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function getAccountOpeningBalanceAction(
  accountId: string,
): Promise<ActionResult<AccountOpeningBalance | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounts:read")) {
    return { ok: false, error: "No tenés permiso para ver cuentas." };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("account_opening_balances")
    .select(
      "account_id, adjustment_date, target_balance, adjustment_transaction_id, notes, created_at, updated_at, adjustment:transactions!account_opening_balances_adjustment_transaction_id_fkey(channel_id)",
    )
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) {
    logger.error("accounts.opening.read_failed", {
      userId: ctx.userId,
      accountId,
      error,
    });
    return { ok: false, error: "No se pudo cargar el saldo de apertura." };
  }
  if (!data) return { ok: true, data: null };
  return {
    ok: true,
    data: {
      account_id: data.account_id,
      adjustment_date: data.adjustment_date,
      target_balance: Number(data.target_balance),
      adjustment_transaction_id: data.adjustment_transaction_id,
      channel_id: data.adjustment?.channel_id ?? null,
      notes: data.notes,
      created_at: data.created_at,
      updated_at: data.updated_at,
    },
  };
}

export async function setAccountOpeningBalanceAction(
  raw: AccountOpeningBalanceInput,
): Promise<ActionResult<void>> {
  const ctx = await requireUserContext();
  // The adjustment rewrites the historical balance — owner only, same as the
  // client adjustment.
  if (!ctx.access.roles.includes("owner")) {
    return {
      ok: false,
      error: "No tenés permiso para ajustar saldos de cuentas.",
    };
  }
  const parsed = AccountOpeningBalanceInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const input = parsed.data;

  const supabase = await createSupabaseClient();
  const { error } = await supabase.rpc("apply_account_opening_balance", {
    p_account_id: input.account_id,
    p_adjustment_date: input.adjustment_date,
    p_target_balance: input.target_balance,
    p_channel_id: input.channel_id,
    p_notes: input.notes ?? undefined,
  });
  if (error) {
    logger.error("accounts.opening.apply_failed", {
      userId: ctx.userId,
      accountId: input.account_id,
      error,
    });
    return {
      ok: false,
      error: error.message ?? "No se pudo aplicar el saldo de apertura.",
    };
  }
  await logAudit(
    "account.opening_balance.applied",
    ctx.userId,
    {
      adjustment_date: input.adjustment_date,
      target_balance: input.target_balance,
      channel_id: input.channel_id,
    },
    input.account_id,
  );
  return { ok: true, data: undefined };
}

export async function clearAccountOpeningBalanceAction(
  accountId: string,
): Promise<ActionResult<void>> {
  const ctx = await requireUserContext();
  if (!ctx.access.roles.includes("owner")) {
    return { ok: false, error: "No tenés permiso para borrar saldos." };
  }
  const supabase = await createSupabaseClient();
  const { error } = await supabase.rpc("clear_account_opening_balance", {
    p_account_id: accountId,
  });
  if (error) {
    logger.error("accounts.opening.clear_failed", {
      userId: ctx.userId,
      accountId,
      error,
    });
    return { ok: false, error: "No se pudo borrar el saldo de apertura." };
  }
  await logAudit("account.opening_balance.cleared", ctx.userId, {}, accountId);
  return { ok: true, data: undefined };
}
