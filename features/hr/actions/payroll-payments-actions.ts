"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

import {
  CreatePayrollPaymentSchema,
  DeletePayrollPaymentSchema,
  isPayrollPaymentMethod,
  UpdatePayrollPaymentSchema,
  type PayrollPayment,
} from "../payroll-schema";

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
    logger.error("audit.insert.failed", { eventType, error });
  }
}

function narrowPayment(row: {
  method: string;
  [key: string]: unknown;
}): PayrollPayment | null {
  if (!isPayrollPaymentMethod(row.method)) {
    logger.error("payroll.unknown_payment_method", { value: row.method });
    return null;
  }
  return row as PayrollPayment;
}

const COLS =
  "id, entry_id, account_id, channel_id, amount, method, paid_at, transaction_id, notes, created_by, created_at, updated_at";

export async function listPayrollPaymentsAction(
  entryId: string,
): Promise<ActionResult<PayrollPayment[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:read")) {
    return { ok: false, error: "Sin permiso para ver pagos." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("payroll_payments")
    .select(COLS)
    .eq("entry_id", entryId)
    .order("paid_at", { ascending: true });

  if (error) {
    logger.error("payroll_payments.list.failed", { error });
    return { ok: false, error: error.message };
  }
  return {
    ok: true,
    data: (data ?? [])
      .map(narrowPayment)
      .filter((row): row is PayrollPayment => row !== null),
  };
}

export async function createPayrollPaymentAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:write")) {
    return { ok: false, error: "Sin permiso para registrar pagos." };
  }
  const parsed = CreatePayrollPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("payroll_payments")
    .insert({
      entry_id: parsed.data.entry_id,
      account_id: parsed.data.account_id,
      channel_id: parsed.data.channel_id,
      amount: parsed.data.amount,
      method: parsed.data.method,
      paid_at: parsed.data.paid_at,
      notes: parsed.data.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    logger.error("payroll_payments.create.failed", { error });
    return { ok: false, error: error?.message ?? "No se pudo registrar el pago." };
  }
  await logAudit(
    "payroll.payment_created",
    ctx.userId,
    {
      entry_id: parsed.data.entry_id,
      amount: parsed.data.amount,
      method: parsed.data.method,
      account_id: parsed.data.account_id,
    },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updatePayrollPaymentAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:write")) {
    return { ok: false, error: "Sin permiso para editar pagos." };
  }
  const parsed = UpdatePayrollPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const { id, ...rest } = parsed.data;

  type PaymentUpdate =
    Database["public"]["Tables"]["payroll_payments"]["Update"];
  const patch: PaymentUpdate = {};
  if (rest.account_id !== undefined) patch.account_id = rest.account_id;
  if (rest.channel_id !== undefined) patch.channel_id = rest.channel_id;
  if (rest.amount !== undefined) patch.amount = rest.amount;
  if (rest.method !== undefined) patch.method = rest.method;
  if (rest.paid_at !== undefined) patch.paid_at = rest.paid_at;
  if (rest.notes !== undefined) patch.notes = rest.notes ?? null;
  if (Object.keys(patch).length === 0) return { ok: true, data: undefined };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("payroll_payments")
    .update(patch)
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  await logAudit(
    "payroll.payment_updated",
    ctx.userId,
    { fields: Object.keys(patch) },
    id,
  );
  return { ok: true, data: undefined };
}

export async function deletePayrollPaymentAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:write")) {
    return { ok: false, error: "Sin permiso para borrar pagos." };
  }
  const parsed = DeletePayrollPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "ID inválido." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("payroll_payments")
    .delete()
    .eq("id", parsed.data.id);

  if (error) return { ok: false, error: error.message };
  await logAudit("payroll.payment_deleted", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}
