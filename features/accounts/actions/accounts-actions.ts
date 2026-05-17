"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import {
  AccountCreateSchema,
  AccountToggleActiveSchema,
  AccountUpdateSchema,
  isAccountCurrency,
  isAccountType,
  type Account,
} from "../schema";
import { getServiceClient } from "@/lib/supabase/service";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [k: string]: JsonValue | undefined }
  | JsonValue[];

const UNIQUE_VIOLATION = "23505";

async function logAudit(
  eventType: string,
  actorId: string,
  payload: { [k: string]: JsonValue | undefined },
  targetResourceId?: string,
) {
  const service = getServiceClient();
  const { error } = await service.from("audit_events").insert({
    actor_id: actorId,
    event_type: eventType,
    target_resource_id: targetResourceId ?? null,
    payload,
  });
  if (error) {
    logger.error("audit.insert.failed", { eventType, error });
  }
}

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
  if (!userCan(ctx.roles, "accounts:read")) {
    return { ok: false, error: "No tenés permiso para ver cuentas." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("accounts")
    .select(SELECT_COLUMNS)
    .order("is_active", { ascending: false })
    .order("name");

  if (error) {
    logger.error("accounts.list.failed", { error });
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
  if (!userCan(ctx.roles, "accounts:write")) {
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
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "Ya existe una cuenta con ese nombre, tipo y moneda.",
      };
    }
    logger.error("accounts.create.failed", { error });
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
  if (!userCan(ctx.roles, "accounts:write")) {
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
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "Ya existe una cuenta con ese nombre, tipo y moneda.",
      };
    }
    logger.error("accounts.update.failed", { error });
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
  if (!userCan(ctx.roles, "accounts:write")) {
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
    logger.error("accounts.toggle_active.failed", { error });
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
// Opening balance (ajuste de saldo de cuenta)
// ---------------------------------------------------------------------------

export interface AccountOpeningBalance {
  account_id: string;
  adjustment_date: string;
  target_balance: number;
  adjustment_transaction_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function getAccountOpeningBalanceAction(
  accountId: string,
): Promise<ActionResult<AccountOpeningBalance | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounts:read")) {
    return { ok: false, error: "No tenés permiso para ver cuentas." };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("account_opening_balances")
    .select(
      "account_id, adjustment_date, target_balance, adjustment_transaction_id, notes, created_at, updated_at",
    )
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) {
    logger.error("accounts.opening.read_failed", { accountId, error });
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
      notes: data.notes,
      created_at: data.created_at,
      updated_at: data.updated_at,
    },
  };
}

export async function setAccountOpeningBalanceAction(input: {
  account_id: string;
  adjustment_date: string;
  target_balance: number;
  channel_id: string;
  notes?: string | null;
}): Promise<ActionResult<void>> {
  const ctx = await requireUserContext();
  // El ajuste reescribe el saldo histórico — solo owner, igual que el
  // ajuste del cliente.
  if (!ctx.roles.includes("owner")) {
    return {
      ok: false,
      error: "No tenés permiso para ajustar saldos de cuentas.",
    };
  }
  if (!input.account_id) return { ok: false, error: "Cuenta requerida." };
  if (!input.channel_id) return { ok: false, error: "Canal requerido." };

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
  if (!ctx.roles.includes("owner")) {
    return { ok: false, error: "No tenés permiso para borrar saldos." };
  }
  const supabase = await createSupabaseClient();
  const { error } = await supabase.rpc("clear_account_opening_balance", {
    p_account_id: accountId,
  });
  if (error) {
    logger.error("accounts.opening.clear_failed", { accountId, error });
    return { ok: false, error: "No se pudo borrar el saldo de apertura." };
  }
  await logAudit(
    "account.opening_balance.cleared",
    ctx.userId,
    {},
    accountId,
  );
  return { ok: true, data: undefined };
}
