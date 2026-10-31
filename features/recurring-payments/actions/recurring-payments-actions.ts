"use server";

import { logAudit } from "@/lib/actions/audit";
import type { JsonValue } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { applyFiscalFilter } from "@/lib/supabase/fiscal-filter";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { paginateRange } from "@/lib/supabase/paginate";

import {
  RecurringPaymentCreateSchema,
  RecurringPaymentToggleSchema,
  RecurringPaymentUpdateSchema,
  isRecurringCategory,
  isRecurringCurrency,
  isRecurringFrequency,
  type RecurringPayment,
} from "../schema";

const SELECT_COLUMNS =
  "id, description, category, amount, currency, frequency, next_due_date, end_date, account_id, channel_id, cost_center_id, is_active, notes, created_at, updated_at";

function narrow(row: {
  category: string;
  currency: string;
  frequency: string;
  amount: number;
  [key: string]: unknown;
}): RecurringPayment | null {
  if (
    !isRecurringCategory(row.category) ||
    !isRecurringCurrency(row.currency) ||
    !isRecurringFrequency(row.frequency)
  ) {
    logger.error("recurring_payments.unknown_enum", {
      category: row.category,
      currency: row.currency,
      frequency: row.frequency,
    });
    return null;
  }
  return { ...row, amount: Number(row.amount) } as RecurringPayment;
}

/** `isFiscal` (`isFiscalFor`): null/undefined = every payment, those with no
 *  channel included; a boolean drops the payments without a channel. */
export async function listRecurringPaymentsAction(
  input: { onlyActive?: boolean; isFiscal?: boolean | null } = {},
): Promise<ActionResult<RecurringPayment[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "recurring_payments:read")) {
    return { ok: false, error: "No tenés permiso para ver pagos recurrentes." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await paginateRange((from, to) => {
    let query = applyFiscalFilter(
      supabase
        .from("recurring_payments")
        .select(`${SELECT_COLUMNS}, channel:invoicing_channels ( is_fiscal )`),
      input.isFiscal,
      "channel",
    )
      .order("is_active", { ascending: false })
      .order("next_due_date");
    if (input.onlyActive) query = query.eq("is_active", true);
    return query.order("id").range(from, to);
  });
  if (error) {
    logger.error("recurring_payments.list.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudieron listar los pagos recurrentes." };
  }

  const rows = (data ?? [])
    .map((row) => narrow(row))
    .filter((row): row is RecurringPayment => row !== null);
  return { ok: true, data: rows };
}

export async function createRecurringPaymentAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "recurring_payments:write")) {
    return {
      ok: false,
      error: "No tenés permiso para crear pagos recurrentes.",
    };
  }

  const parsed = RecurringPaymentCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("recurring_payments")
    .insert({
      description: parsed.data.description,
      category: parsed.data.category,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      frequency: parsed.data.frequency,
      next_due_date: parsed.data.next_due_date,
      end_date: parsed.data.end_date ?? null,
      account_id: parsed.data.account_id ?? null,
      channel_id: parsed.data.channel_id ?? null,
      cost_center_id: parsed.data.cost_center_id ?? null,
      notes: parsed.data.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error) {
    logger.error("recurring_payments.create.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo crear el pago recurrente." };
  }

  await logAudit(
    "recurring_payment.created",
    ctx.userId,
    {
      description: parsed.data.description,
      category: parsed.data.category,
      amount: parsed.data.amount,
      frequency: parsed.data.frequency,
    },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updateRecurringPaymentAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "recurring_payments:write")) {
    return {
      ok: false,
      error: "No tenés permiso para editar pagos recurrentes.",
    };
  }

  const parsed = RecurringPaymentUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { id, ...rest } = parsed.data;

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("recurring_payments")
    .update({
      ...(rest.description !== undefined && { description: rest.description }),
      ...(rest.category !== undefined && { category: rest.category }),
      ...(rest.amount !== undefined && { amount: rest.amount }),
      ...(rest.currency !== undefined && { currency: rest.currency }),
      ...(rest.frequency !== undefined && { frequency: rest.frequency }),
      ...(rest.next_due_date !== undefined && {
        next_due_date: rest.next_due_date,
      }),
      ...(rest.end_date !== undefined && { end_date: rest.end_date }),
      ...(rest.account_id !== undefined && { account_id: rest.account_id }),
      ...(rest.channel_id !== undefined && { channel_id: rest.channel_id }),
      ...(rest.cost_center_id !== undefined && {
        cost_center_id: rest.cost_center_id,
      }),
      ...(rest.is_active !== undefined && { is_active: rest.is_active }),
      ...(rest.notes !== undefined && { notes: rest.notes }),
    })
    .eq("id", id);

  if (error) {
    logger.error("recurring_payments.update.failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo actualizar el pago recurrente." };
  }

  await logAudit(
    "recurring_payment.updated",
    ctx.userId,
    { fields: Object.keys(rest) as JsonValue[] },
    id,
  );
  return { ok: true, data: undefined };
}

export async function setRecurringPaymentActiveAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "recurring_payments:write")) {
    return {
      ok: false,
      error: "No tenés permiso para editar pagos recurrentes.",
    };
  }

  const parsed = RecurringPaymentToggleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("recurring_payments")
    .update({ is_active: parsed.data.is_active })
    .eq("id", parsed.data.id);

  if (error) {
    logger.error("recurring_payments.toggle.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error,
    });
    return { ok: false, error: "No se pudo cambiar el estado." };
  }

  await logAudit(
    parsed.data.is_active
      ? "recurring_payment.reactivated"
      : "recurring_payment.deactivated",
    ctx.userId,
    {},
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}

export async function deleteRecurringPaymentAction(input: {
  id: string;
}): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "recurring_payments:write")) {
    return {
      ok: false,
      error: "No tenés permiso para borrar pagos recurrentes.",
    };
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("recurring_payments")
    .delete()
    .eq("id", input.id);

  if (error) {
    logger.error("recurring_payments.delete.failed", {
      userId: ctx.userId,
      id: input.id,
      error,
    });
    return { ok: false, error: "No se pudo borrar el pago recurrente." };
  }

  await logAudit("recurring_payment.deleted", ctx.userId, {}, input.id);
  return { ok: true, data: undefined };
}
