"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

import {
  ChequeCreateSchema,
  CreditChequeSchema,
  DepositChequeSchema,
  isChequeCurrency,
  isChequeKind,
  isChequeStatus,
  RejectChequeSchema,
  type Cheque,
  type CheckMovement,
} from "../schema";

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
    logger.error("audit.insert.failed", {
      userId: actorId,
      eventType,
      targetResourceId,
      error,
    });
  }
}

function narrowCheck(row: {
  kind: string;
  status: string;
  currency: string;
  [key: string]: unknown;
}): Cheque | null {
  if (!isChequeKind(row.kind)) {
    logger.error("cheques.unknown_kind", { value: row.kind });
    return null;
  }
  if (!isChequeStatus(row.status)) {
    logger.error("cheques.unknown_status", { value: row.status });
    return null;
  }
  if (!isChequeCurrency(row.currency)) {
    logger.error("cheques.unknown_currency", { value: row.currency });
    return null;
  }
  return row as Cheque;
}

const CHECK_COLUMNS =
  "id, kind, check_number, bank_name, drawer_name, drawer_cuit, issue_date, due_date, amount, currency, source_kind, source_receipt_id, source_payment_line_id, source_client_id, cartera_account_id, status, notes, created_by, created_at, updated_at";

/** Embedded joins en select queries de cheques: cartera_account siempre,
 *  source_client opcional según si el cheque venía de un recibo. */
type CarteraAccountJoin = { cartera_account: { name: string } | null };
type SourceClientLegalJoin = {
  source_client: { legal_name: string } | null;
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface CheckListItem extends Cheque {
  cartera_account_name: string;
  source_client_legal_name: string | null;
}

export async function listChecksAction(): Promise<
  ActionResult<{ items: CheckListItem[] }>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "cheques:read")) {
    return { ok: false, error: "No tenés permiso para ver cheques." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("checks")
    .select(
      `${CHECK_COLUMNS},
       cartera_account:accounts!checks_cartera_account_id_fkey(name),
       source_client:clients(legal_name)`,
    )
    .order("due_date", { ascending: true })
    .limit(500);

  if (error) {
    logger.error("cheques.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar los cheques." };
  }

  const items: CheckListItem[] = (data ?? [])
    .map((row) => {
      const narrowed = narrowCheck(row);
      if (!narrowed) return null;
      const cartera = (row as CarteraAccountJoin).cartera_account;
      const sourceClient = (row as SourceClientLegalJoin).source_client;
      return {
        ...narrowed,
        cartera_account_name: cartera?.name ?? "—",
        source_client_legal_name: sourceClient?.legal_name ?? null,
      };
    })
    .filter((c): c is CheckListItem => c !== null);

  return { ok: true, data: { items } };
}

export type EnCarteraCheck = {
  id: string;
  kind: "fisico" | "echeq";
  check_number: string;
  bank_name: string;
  drawer_name: string;
  due_date: string;
  amount: number;
  currency: "ARS" | "USD";
  cartera_account_id: string;
  cartera_account_name: string;
};

export async function listEnCarteraChecksAction(filters?: {
  currency?: "ARS" | "USD";
}): Promise<ActionResult<EnCarteraCheck[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "cheques:read")) {
    return { ok: false, error: "No tenés permiso para ver cheques." };
  }
  const supabase = await createSupabaseClient();
  let query = supabase
    .from("checks")
    .select(
      "id, kind, check_number, bank_name, drawer_name, due_date, amount, currency, cartera_account_id, cartera_account:accounts!checks_cartera_account_id_fkey(name)",
    )
    .eq("status", "en_cartera")
    .order("due_date", { ascending: true });
  if (filters?.currency) query = query.eq("currency", filters.currency);

  const { data, error } = await query;
  if (error) {
    logger.error("cheques.en_cartera.list.failed", {
      userId: ctx.userId,
      currency: filters?.currency,
      error,
    });
    return { ok: false, error: "No se pudieron listar cheques en cartera." };
  }
  const items: EnCarteraCheck[] = (data ?? [])
    .filter(
      (row): row is typeof row & { kind: "fisico" | "echeq" } =>
        row.kind === "fisico" || row.kind === "echeq",
    )
    .filter(
      (row): row is typeof row & { currency: "ARS" | "USD" } =>
        row.currency === "ARS" || row.currency === "USD",
    )
    .map((row) => {
      const acct = (row as CarteraAccountJoin).cartera_account;
      return {
        id: row.id,
        kind: row.kind,
        check_number: row.check_number,
        bank_name: row.bank_name,
        drawer_name: row.drawer_name,
        due_date: row.due_date,
        amount: Number(row.amount),
        currency: row.currency,
        cartera_account_id: row.cartera_account_id,
        cartera_account_name: acct?.name ?? "—",
      };
    });
  return { ok: true, data: items };
}

export interface ChequeDetail {
  check: Cheque;
  movements: CheckMovement[];
}

export async function getChequeByIdAction(
  id: string,
): Promise<ActionResult<ChequeDetail | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "cheques:read")) {
    return { ok: false, error: "No tenés permiso para ver cheques." };
  }

  const supabase = await createSupabaseClient();
  const { data: chequeRow, error: chequeErr } = await supabase
    .from("checks")
    .select(CHECK_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (chequeErr) {
    logger.error("cheques.get.failed", {
      userId: ctx.userId,
      id,
      error: chequeErr,
    });
    return { ok: false, error: "No se pudo cargar el check." };
  }
  if (!chequeRow) return { ok: true, data: null };
  const check = narrowCheck(chequeRow);
  if (!check) return { ok: false, error: "Cheque con datos inválidos." };

  const { data: movements, error: movErr } = await supabase
    .from("check_movements")
    .select("*")
    .eq("check_id", id)
    .order("event_date", { ascending: true });

  if (movErr) {
    logger.error("cheques.get.movements_failed", {
      userId: ctx.userId,
      id,
      error: movErr,
    });
    return { ok: false, error: "No se pudieron cargar los movimientos." };
  }

  return {
    ok: true,
    data: { check, movements: movements ?? [] },
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createCheckAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "cheques:write")) {
    return { ok: false, error: "No tenés permiso para registrar cheques." };
  }

  const parsed = ChequeCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const data = parsed.data;

  const supabase = await createSupabaseClient();
  const { data: row, error } = await supabase
    .from("checks")
    .insert({
      kind: data.kind,
      check_number: data.check_number,
      bank_name: data.bank_name,
      drawer_name: data.drawer_name,
      drawer_cuit: data.drawer_cuit ?? null,
      issue_date: data.issue_date,
      due_date: data.due_date,
      amount: data.amount,
      currency: data.currency,
      cartera_account_id: data.cartera_account_id,
      source_kind: data.source_kind,
      source_receipt_id: data.source_receipt_id ?? null,
      source_payment_line_id: data.source_payment_line_id ?? null,
      source_client_id: data.source_client_id ?? null,
      notes: data.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: `Ya existe un check ${data.check_number} para ${data.bank_name}.`,
      };
    }
    logger.error("cheques.create.failed", {
      userId: ctx.userId,
      bank_name: data.bank_name,
      check_number: data.check_number,
      error,
    });
    return {
      ok: false,
      error: error.message ?? "No se pudo registrar el check.",
    };
  }

  // Insert the initial 'received' movement so the timeline has an anchor.
  await supabase.from("check_movements").insert({
    check_id: row.id,
    event: "received",
    event_date: data.issue_date,
    notes: null,
    created_by: ctx.userId,
  });

  await logAudit(
    "check.created",
    ctx.userId,
    {
      kind: data.kind,
      bank_name: data.bank_name,
      check_number: data.check_number,
      amount: data.amount,
    },
    row.id,
  );
  return { ok: true, data: { id: row.id } };
}

export async function depositCheckAction(
  input: unknown,
): Promise<ActionResult<{ movement_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "cheques:write")) {
    return { ok: false, error: "No tenés permiso para depositar cheques." };
  }

  const parsed = DepositChequeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const data = parsed.data;

  const supabase = await createSupabaseClient();
  const { data: id, error } = await supabase.rpc("deposit_check", {
    p_check_id: data.check_id,
    p_account_id: data.account_id,
    p_event_date: data.event_date,
    p_channel_id: data.channel_id,
    p_description: data.description ?? "",
  });

  if (error) {
    logger.error("cheques.deposit.failed", {
      userId: ctx.userId,
      check_id: data.check_id,
      error,
    });
    return {
      ok: false,
      error: error.message ?? "No se pudo depositar el check.",
    };
  }

  await logAudit(
    "check.deposited",
    ctx.userId,
    { destination_account_id: data.account_id },
    data.check_id,
  );
  return { ok: true, data: { movement_id: id as string } };
}

export async function creditCheckAction(
  input: unknown,
): Promise<ActionResult<{ movement_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "cheques:write")) {
    return { ok: false, error: "No tenés permiso para acreditar cheques." };
  }

  const parsed = CreditChequeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const data = parsed.data;

  const supabase = await createSupabaseClient();
  const { data: id, error } = await supabase.rpc("credit_check", {
    p_check_id: data.check_id,
    p_event_date: data.event_date,
    p_notes: data.notes ?? "",
  });
  if (error) {
    logger.error("cheques.credit.failed", {
      userId: ctx.userId,
      check_id: data.check_id,
      error,
    });
    return {
      ok: false,
      error: error.message ?? "No se pudo acreditar el check.",
    };
  }

  await logAudit("check.credited", ctx.userId, {}, data.check_id);
  return { ok: true, data: { movement_id: id as string } };
}

export async function rejectCheckAction(
  input: unknown,
): Promise<ActionResult<{ movement_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "cheques:write")) {
    return { ok: false, error: "No tenés permiso para rechazar cheques." };
  }

  const parsed = RejectChequeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const data = parsed.data;

  const supabase = await createSupabaseClient();
  const { data: id, error } = await supabase.rpc("reject_check", {
    p_check_id: data.check_id,
    p_account_id: data.account_id,
    p_event_date: data.event_date,
    p_channel_id: data.channel_id,
    p_notes: data.notes ?? "",
  });
  if (error) {
    logger.error("cheques.reject.failed", {
      userId: ctx.userId,
      check_id: data.check_id,
      error,
    });
    return {
      ok: false,
      error: error.message ?? "No se pudo rechazar el check.",
    };
  }

  await logAudit("check.rejected", ctx.userId, {}, data.check_id);
  return { ok: true, data: { movement_id: id as string } };
}
