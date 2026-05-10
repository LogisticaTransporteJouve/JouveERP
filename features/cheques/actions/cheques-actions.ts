"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

import {
  ChequeCreateSchema,
  CreditChequeSchema,
  DepositChequeSchema,
  EndorseChequeSchema,
  isChequeCurrency,
  isChequeKind,
  isChequeStatus,
  RejectChequeSchema,
  type Cheque,
  type ChequeMovement,
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

function narrowCheque(row: {
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
  return row as unknown as Cheque;
}

const CHEQUE_COLUMNS =
  "id, kind, cheque_number, bank_name, drawer_name, drawer_cuit, issue_date, due_date, amount, currency, source_kind, source_receipt_id, source_payment_line_id, source_client_id, cartera_account_id, status, notes, created_by, created_at, updated_at";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ChequeListItem extends Cheque {
  cartera_account_name: string;
  source_client_legal_name: string | null;
}

export async function listChequesAction(): Promise<
  ActionResult<{ items: ChequeListItem[] }>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "cheques:read")) {
    return { ok: false, error: "No tenés permiso para ver cheques." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("cheques")
    .select(
      `${CHEQUE_COLUMNS},
       cartera_account:accounts!cheques_cartera_account_id_fkey(name),
       source_client:clients(legal_name)`,
    )
    .order("due_date", { ascending: true });

  if (error) {
    logger.error("cheques.list.failed", { error });
    return { ok: false, error: "No se pudieron listar los cheques." };
  }

  const items: ChequeListItem[] = (data ?? [])
    .map((row) => {
      const narrowed = narrowCheque(row);
      if (!narrowed) return null;
      const cartera = (row as { cartera_account: { name: string } | null })
        .cartera_account;
      const sourceClient = (
        row as { source_client: { legal_name: string } | null }
      ).source_client;
      return {
        ...narrowed,
        cartera_account_name: cartera?.name ?? "—",
        source_client_legal_name: sourceClient?.legal_name ?? null,
      };
    })
    .filter((c): c is ChequeListItem => c !== null);

  return { ok: true, data: { items } };
}

export interface ChequeDetail {
  cheque: Cheque;
  movements: ChequeMovement[];
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
    .from("cheques")
    .select(CHEQUE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (chequeErr) {
    logger.error("cheques.get.failed", { id, error: chequeErr });
    return { ok: false, error: "No se pudo cargar el cheque." };
  }
  if (!chequeRow) return { ok: true, data: null };
  const cheque = narrowCheque(chequeRow);
  if (!cheque) return { ok: false, error: "Cheque con datos inválidos." };

  const { data: movements, error: movErr } = await supabase
    .from("cheque_movements")
    .select("*")
    .eq("cheque_id", id)
    .order("event_date", { ascending: true });

  if (movErr) {
    logger.error("cheques.get.movements_failed", { id, error: movErr });
    return { ok: false, error: "No se pudieron cargar los movimientos." };
  }

  return {
    ok: true,
    data: { cheque, movements: movements ?? [] },
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createChequeAction(
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
    .from("cheques")
    .insert({
      kind: data.kind,
      cheque_number: data.cheque_number,
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
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: `Ya existe un cheque ${data.cheque_number} para ${data.bank_name}.`,
      };
    }
    logger.error("cheques.create.failed", { error });
    return {
      ok: false,
      error: error.message ?? "No se pudo registrar el cheque.",
    };
  }

  // Insert the initial 'received' movement so the timeline has an anchor.
  await supabase.from("cheque_movements").insert({
    cheque_id: row.id,
    event: "received",
    event_date: data.issue_date,
    notes: null,
    created_by: ctx.userId,
  });

  await logAudit(
    "cheque.created",
    ctx.userId,
    {
      kind: data.kind,
      bank_name: data.bank_name,
      cheque_number: data.cheque_number,
      amount: data.amount,
    },
    row.id,
  );
  return { ok: true, data: { id: row.id } };
}

export async function depositChequeAction(
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
  const { data: id, error } = await supabase.rpc("deposit_cheque", {
    p_cheque_id: data.cheque_id,
    p_account_id: data.account_id,
    p_event_date: data.event_date,
    p_channel_id: data.channel_id,
    p_description: data.description ?? "",
  });

  if (error) {
    logger.error("cheques.deposit.failed", { error });
    return {
      ok: false,
      error: error.message ?? "No se pudo depositar el cheque.",
    };
  }

  await logAudit(
    "cheque.deposited",
    ctx.userId,
    { destination_account_id: data.account_id },
    data.cheque_id,
  );
  return { ok: true, data: { movement_id: id as string } };
}

export async function creditChequeAction(
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
  const { data: id, error } = await supabase.rpc("credit_cheque", {
    p_cheque_id: data.cheque_id,
    p_event_date: data.event_date,
    p_notes: data.notes ?? "",
  });
  if (error) {
    logger.error("cheques.credit.failed", { error });
    return {
      ok: false,
      error: error.message ?? "No se pudo acreditar el cheque.",
    };
  }

  await logAudit("cheque.credited", ctx.userId, {}, data.cheque_id);
  return { ok: true, data: { movement_id: id as string } };
}

export async function endorseChequeAction(
  input: unknown,
): Promise<ActionResult<{ movement_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "cheques:write")) {
    return { ok: false, error: "No tenés permiso para endosar cheques." };
  }

  const parsed = EndorseChequeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const data = parsed.data;

  const supabase = await createSupabaseClient();
  const { data: id, error } = await supabase.rpc("endorse_cheque", {
    p_cheque_id: data.cheque_id,
    p_event_date: data.event_date,
    p_channel_id: data.channel_id,
    p_endorsed_to_name: data.endorsed_to_name,
    p_endorsed_to_cuit: data.endorsed_to_cuit ?? "",
    p_notes: data.notes ?? "",
  });
  if (error) {
    logger.error("cheques.endorse.failed", { error });
    return {
      ok: false,
      error: error.message ?? "No se pudo endosar el cheque.",
    };
  }

  await logAudit(
    "cheque.endorsed",
    ctx.userId,
    { endorsed_to_name: data.endorsed_to_name },
    data.cheque_id,
  );
  return { ok: true, data: { movement_id: id as string } };
}

export async function rejectChequeAction(
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
  const { data: id, error } = await supabase.rpc("reject_cheque", {
    p_cheque_id: data.cheque_id,
    p_account_id: data.account_id,
    p_event_date: data.event_date,
    p_channel_id: data.channel_id,
    p_notes: data.notes ?? "",
  });
  if (error) {
    logger.error("cheques.reject.failed", { error });
    return {
      ok: false,
      error: error.message ?? "No se pudo rechazar el cheque.",
    };
  }

  await logAudit("cheque.rejected", ctx.userId, {}, data.cheque_id);
  return { ok: true, data: { movement_id: id as string } };
}
