import "server-only";

import type { z } from "zod";

import type {
  CreateManualMovementSchema,
  RecordAccountCashSchema,
} from "@/features/hr/account-schema";
import { logAudit } from "@/lib/actions/audit";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

// Writes of the employee's cuenta corriente (decision D1), with the caller's
// session (RLS): the employee account card and an accepted assistant
// proposal. Balances and plan progress are the database's.

/**
 * "Adelanto a empleado" / "Pago del empleado": the treasury movement and the
 * account movement in one RPC (`record_employee_account_cash`), then the
 * audit. The caller has already checked HR_CASH_PERMISSIONS (hr:write +
 * transactions:write) and parsed the input with `RecordAccountCashSchema`.
 */
export async function recordEmployeeAccountCash(
  actorId: string,
  v: z.output<typeof RecordAccountCashSchema>,
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_employee_account_cash", {
    p_employee_id: v.employee_id,
    p_kind: v.kind,
    p_account_id: v.account_id,
    p_channel_id: v.channel_id,
    p_date: v.date,
    p_amount: v.amount,
    ...(v.description ? { p_description: v.description } : {}),
    ...(v.plan_id ? { p_plan_id: v.plan_id } : {}),
    ...(v.installment_amount != null
      ? { p_installment_amount: v.installment_amount }
      : {}),
  });
  if (error || !data) {
    if (error && !error.hint) {
      logger.error("employee_account.cash.failed", { userId: actorId, error });
    }
    return {
      ok: false,
      error:
        mapDbGuardError(error, {
          slug: "employee_account.cash.rejected",
          userId: actorId,
        }) ??
        (v.kind === "advance"
          ? "No se pudo registrar el adelanto."
          : "No se pudo registrar el pago."),
    };
  }
  await logAudit(
    v.kind === "advance"
      ? "employee.advance_recorded"
      : "employee.account_payment_recorded",
    actorId,
    {
      employee_id: v.employee_id,
      account_id: v.account_id,
      channel_id: v.channel_id,
      date: v.date,
      amount: v.amount,
      plan_id: v.plan_id ?? null,
      installment_amount: v.installment_amount ?? null,
    },
    data,
  );
  return { ok: true, data: { id: data } };
}

/**
 * A charge or a payment typed by hand (no cash movement): a debt to a
 * partner, an opening balance, a payment received outside the company. The
 * caller has already checked `hr:write` and parsed the input with
 * `CreateManualMovementSchema`.
 */
export async function createEmployeeAccountMovement(
  actorId: string,
  v: z.output<typeof CreateManualMovementSchema>,
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_account_movements")
    .insert({
      employee_id: v.employee_id,
      kind: v.kind,
      currency: v.currency,
      amount: v.amount,
      movement_date: v.movement_date,
      description: v.description,
      creditor: v.creditor,
      plan_id: v.plan_id ?? null,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (error && !error.hint) {
      logger.error("employee_account.manual.failed", {
        userId: actorId,
        error,
      });
    }
    return {
      ok: false,
      error:
        mapDbGuardError(error, {
          slug: "employee_account.manual.rejected",
          userId: actorId,
        }) ?? "No se pudo cargar el movimiento.",
    };
  }
  await logAudit(
    "employee.account_movement_created",
    actorId,
    {
      employee_id: v.employee_id,
      kind: v.kind,
      currency: v.currency,
      amount: v.amount,
      creditor: v.creditor,
      plan_id: v.plan_id ?? null,
    },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}
