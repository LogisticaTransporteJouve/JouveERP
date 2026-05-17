"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

import type { SupplierListLegalJoin } from "@/features/suppliers/schema";

import {
  IssuedCheckCreateSchema,
  IssuedCheckTransitionSchema,
  IssuedCheckUpdateSchema,
  isIssuedCheckCurrency,
  isIssuedCheckKind,
  isIssuedCheckStatus,
  type IssuedCheck,
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
  if (error) logger.error("audit.insert.failed", { userId: actorId, eventType, targetResourceId, error });
}

function narrow(row: Record<string, unknown>): IssuedCheck | null {
  if (!isIssuedCheckKind(row.kind)) return null;
  if (!isIssuedCheckStatus(row.status)) return null;
  if (!isIssuedCheckCurrency(row.currency)) return null;
  return row as IssuedCheck;
}

const COLUMNS =
  "id, kind, check_number, bank_name, beneficiary_name, beneficiary_cuit, issue_date, due_date, amount, currency, bank_account_id, payment_order_id, supplier_id, status, cashed_at, rejected_at, cancelled_at, cancelled_by, notes, created_by, created_at, updated_at";

export async function listIssuedChecksAction(): Promise<
  ActionResult<IssuedCheck[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "issued_checks:read")) {
    return { ok: false, error: "No tenés permiso para ver cheques propios." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issued_checks")
    .select(
      `${COLUMNS}, suppliers ( legal_name ), accounts!issued_checks_bank_account_id_fkey ( name )`,
    )
    .order("due_date", { ascending: true })
    .limit(500);

  if (error) {
    logger.error("issued_checks.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar los cheques propios." };
  }

  const items: IssuedCheck[] = (data ?? [])
    .map((row) => {
      const sup = (row as unknown as SupplierListLegalJoin).suppliers;
      const acc = (row as { accounts: { name: string } | null }).accounts;
      const flat: Record<string, unknown> = {
        ...row,
        supplier_legal_name: sup?.legal_name ?? null,
        bank_account_name: acc?.name ?? null,
      };
      delete flat.suppliers;
      delete flat.accounts;
      return narrow(flat);
    })
    .filter((r): r is IssuedCheck => r !== null);

  return { ok: true, data: items };
}

export async function createIssuedCheckAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "issued_checks:write")) {
    return { ok: false, error: "No tenés permiso para cargar cheques propios." };
  }

  const parsed = IssuedCheckCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issued_checks")
    .insert({
      kind: parsed.data.kind,
      check_number: parsed.data.check_number,
      bank_name: parsed.data.bank_name,
      beneficiary_name: parsed.data.beneficiary_name ?? null,
      beneficiary_cuit: parsed.data.beneficiary_cuit ?? null,
      issue_date: parsed.data.issue_date,
      due_date: parsed.data.due_date,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      bank_account_id: parsed.data.bank_account_id,
      payment_order_id: parsed.data.payment_order_id ?? null,
      supplier_id: parsed.data.supplier_id ?? null,
      notes: parsed.data.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "Ya cargaste un cheque con ese número del mismo banco.",
      };
    }
    logger.error("issued_checks.create.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo cargar el cheque." };
  }

  await logAudit(
    "issued_check.created",
    ctx.userId,
    {
      check_number: parsed.data.check_number,
      amount: parsed.data.amount,
    },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updateIssuedCheckAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "issued_checks:write")) {
    return { ok: false, error: "No tenés permiso para editar cheques." };
  }

  const parsed = IssuedCheckUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const { id, ...rest } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("issued_checks")
    .update({
      ...(rest.kind !== undefined && { kind: rest.kind }),
      ...(rest.check_number !== undefined && { check_number: rest.check_number }),
      ...(rest.bank_name !== undefined && { bank_name: rest.bank_name }),
      ...(rest.beneficiary_name !== undefined && {
        beneficiary_name: rest.beneficiary_name ?? null,
      }),
      ...(rest.beneficiary_cuit !== undefined && {
        beneficiary_cuit: rest.beneficiary_cuit ?? null,
      }),
      ...(rest.issue_date !== undefined && { issue_date: rest.issue_date }),
      ...(rest.due_date !== undefined && { due_date: rest.due_date }),
      ...(rest.amount !== undefined && { amount: rest.amount }),
      ...(rest.currency !== undefined && { currency: rest.currency }),
      ...(rest.bank_account_id !== undefined && {
        bank_account_id: rest.bank_account_id,
      }),
      ...(rest.payment_order_id !== undefined && {
        payment_order_id: rest.payment_order_id ?? null,
      }),
      ...(rest.supplier_id !== undefined && {
        supplier_id: rest.supplier_id ?? null,
      }),
      ...(rest.notes !== undefined && { notes: rest.notes ?? null }),
    })
    .eq("id", id);

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "Otro cheque del mismo banco ya usa ese número.",
      };
    }
    logger.error("issued_checks.update.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo actualizar el cheque." };
  }

  await logAudit(
    "issued_check.updated",
    ctx.userId,
    { fields: Object.keys(rest) as JsonValue[] },
    id,
  );
  return { ok: true, data: undefined };
}

export async function transitionIssuedCheckAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "issued_checks:write")) {
    return { ok: false, error: "No tenés permiso." };
  }

  const parsed = IssuedCheckTransitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const today = new Date().toISOString().slice(0, 10);
  const eventDate = parsed.data.event_date ?? today;

  const supabase = await createClient();
  const update = {
    status: parsed.data.to_status,
    cashed_at: parsed.data.to_status === "cashed" ? eventDate : null,
    rejected_at: parsed.data.to_status === "rejected" ? eventDate : null,
    cancelled_at:
      parsed.data.to_status === "cancelled" ? new Date().toISOString() : null,
    cancelled_by:
      parsed.data.to_status === "cancelled" ? ctx.userId : null,
  };

  const { error } = await supabase
    .from("issued_checks")
    .update(update)
    .eq("id", parsed.data.id);

  if (error) {
    logger.error("issued_checks.transition.failed", { userId: ctx.userId, error });
    return {
      ok: false,
      error: error.message ?? "No se pudo cambiar el estado.",
    };
  }

  await logAudit(
    `issued_check.${parsed.data.to_status}`,
    ctx.userId,
    { event_date: eventDate },
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}
