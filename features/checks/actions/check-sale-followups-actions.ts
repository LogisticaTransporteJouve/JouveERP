"use server";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { scopeIsFiscalFor, userCan } from "@/lib/auth/permissions";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { todayInAR } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { applyFiscalFilter } from "@/lib/supabase/fiscal-filter";
import { paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import {
  CancelCheckSaleSchema,
  PayCheckSaleDebtSchema,
  RejectSoldCheckAsDebtSchema,
  isCheckSaleCurrency,
  isCheckSaleStatus,
  sumByCurrency,
  type CancelCheckSaleInput,
  type CheckSale,
  type CheckSaleCurrency,
  type CheckSaleDebt,
  type PayCheckSaleDebtInput,
  type RejectSoldCheckAsDebtInput,
  type SoldChecksExposure,
} from "../lib/check-sales";

// Check sales after the fact: the list (to anul one entered by mistake), the
// debt to the buyer of a rejected sold check, and the exposure Tesorería
// shows. Read with cheques:read, written with cheques:write; the service
// client after the gate, as sellChecksAction (the RPCs are service-only).

const READ_DENIED = "No tenés permiso para ver cheques.";
const WRITE_DENIED = "No tenés permiso para operar cheques.";

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

/** The latest 200 sales, newest first, with their checks. */
export async function listCheckSalesAction(input?: {
  isFiscal?: boolean | null;
}): Promise<ActionResult<CheckSale[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "cheques:read")) {
    return { ok: false, error: READ_DENIED };
  }
  const isFiscal = scopeIsFiscalFor(ctx.access, input?.isFiscal);
  const { data, error } = await applyFiscalFilter(
    getServiceClient()
      .from("check_sales")
      .select(
        "id, sale_date, buyer_name, currency, gross_amount, interest_amount, commission_amount, net_amount, status, cancel_reason, account:accounts(name), channel:invoicing_channels(is_fiscal), transfers:transactions(kind)",
      ),
    isFiscal,
    "channel",
  )
    .order("sale_date", { ascending: false })
    .order("id")
    .limit(200);
  if (error) {
    logger.error("check_sales.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar las ventas de cheques." };
  }
  const sales: CheckSale[] = [];
  for (const row of data ?? []) {
    if (!isCheckSaleStatus(row.status) || !isCheckSaleCurrency(row.currency)) {
      logger.error("check_sales.unknown_value", {
        id: row.id,
        status: row.status,
        currency: row.currency,
      });
      continue;
    }
    sales.push({
      id: row.id,
      sale_date: row.sale_date,
      buyer_name: row.buyer_name,
      account_name: row.account?.name ?? "—",
      currency: row.currency,
      gross_amount: Number(row.gross_amount),
      interest_amount: Number(row.interest_amount),
      commission_amount: Number(row.commission_amount),
      net_amount: Number(row.net_amount),
      status: row.status,
      cancel_reason: row.cancel_reason,
      // One transfer out of the cartera per check (sell_checks).
      checks: row.transfers.filter((t) => t.kind === "transfer_out").length,
    });
  }
  return { ok: true, data: sales };
}

/** "Anular venta": the checks go back to cartera and the sale's movements
 *  are deleted. Refused once a check moved or the period closed. */
export async function cancelCheckSaleAction(
  input: CancelCheckSaleInput,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "cheques:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = CancelCheckSaleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const { error } = await getServiceClient().rpc("cancel_check_sale", {
    p_sale_id: parsed.data.sale_id,
    p_reason: parsed.data.reason,
    p_user_id: ctx.userId,
  });
  if (error) {
    const guard = mapDbGuardError(error, {
      slug: "check_sales.cancel.rejected",
      userId: ctx.userId,
      id: parsed.data.sale_id,
    });
    if (guard) return { ok: false, error: guard };
    logger.error("check_sales.cancel.failed", {
      userId: ctx.userId,
      id: parsed.data.sale_id,
      error,
    });
    return { ok: false, error: "No se pudo anular la venta." };
  }
  await logAudit(
    "check_sale.cancelled",
    ctx.userId,
    { reason: parsed.data.reason },
    parsed.data.sale_id,
  );
  return { ok: true, data: undefined };
}

/** A sold check rejected that the buyer debits later: no movement now, a
 *  debt to the buyer instead. */
export async function rejectSoldCheckAsDebtAction(
  input: RejectSoldCheckAsDebtInput,
): Promise<ActionResult<{ debt_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "cheques:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = RejectSoldCheckAsDebtSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const { data, error } = await getServiceClient().rpc(
    "reject_sold_check_as_debt",
    {
      p_check_id: parsed.data.check_id,
      p_event_date: parsed.data.event_date,
      p_notes: parsed.data.notes ?? "",
      p_user_id: ctx.userId,
    },
  );
  if (error || !data) {
    const guard = mapDbGuardError(error, {
      slug: "check_sales.reject_debt.rejected",
      userId: ctx.userId,
      id: parsed.data.check_id,
    });
    if (guard) return { ok: false, error: guard };
    logger.error("check_sales.reject_debt.failed", {
      userId: ctx.userId,
      id: parsed.data.check_id,
      error,
    });
    return { ok: false, error: "No se pudo rechazar el cheque." };
  }
  await logAudit(
    "check.rejected_as_sale_debt",
    ctx.userId,
    { debt_id: data },
    parsed.data.check_id,
  );
  return { ok: true, data: { debt_id: data } };
}

/** Debts to buyers of rejected sold checks: pending first, then the latest
 *  100 paid. */
export async function listCheckSaleDebtsAction(): Promise<
  ActionResult<CheckSaleDebt[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "cheques:read")) {
    return { ok: false, error: READ_DENIED };
  }
  const { data, error } = await getServiceClient()
    .from("check_sale_debts")
    .select(
      "id, check_id, amount, currency, rejected_on, paid_at, check:checks(check_number, bank_name), sale:check_sales(buyer_name)",
    )
    .order("paid_at", { ascending: false, nullsFirst: true })
    .order("rejected_on", { ascending: false })
    .order("id")
    .limit(200);
  if (error) {
    logger.error("check_sales.debts.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron leer las deudas por cheques." };
  }
  const debts: CheckSaleDebt[] = [];
  for (const row of data ?? []) {
    if (!isCheckSaleCurrency(row.currency)) {
      logger.error("check_sales.debts.unknown_currency", { id: row.id });
      continue;
    }
    debts.push({
      id: row.id,
      check_id: row.check_id,
      check_number: row.check?.check_number ?? "—",
      bank_name: row.check?.bank_name ?? "—",
      buyer_name: row.sale?.buyer_name ?? "—",
      amount: Number(row.amount),
      currency: row.currency,
      rejected_on: row.rejected_on,
      paid_at: row.paid_at,
    });
  }
  return { ok: true, data: debts };
}

/** Pays a debt to the buyer from an account (the buyer debits it now). */
export async function payCheckSaleDebtAction(
  input: PayCheckSaleDebtInput,
): Promise<ActionResult<{ transaction_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "cheques:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = PayCheckSaleDebtSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const { data, error } = await getServiceClient().rpc("pay_check_sale_debt", {
    p_debt_id: parsed.data.debt_id,
    p_account_id: parsed.data.account_id,
    p_payment_date: parsed.data.payment_date,
    p_user_id: ctx.userId,
  });
  if (error || !data) {
    const guard = mapDbGuardError(error, {
      slug: "check_sales.pay_debt.rejected",
      userId: ctx.userId,
      id: parsed.data.debt_id,
    });
    if (guard) return { ok: false, error: guard };
    logger.error("check_sales.pay_debt.failed", {
      userId: ctx.userId,
      id: parsed.data.debt_id,
      error,
    });
    return { ok: false, error: "No se pudo pagar la deuda." };
  }
  await logAudit(
    "check_sale_debt.paid",
    ctx.userId,
    { transaction_id: data, account_id: parsed.data.account_id },
    parsed.data.debt_id,
  );
  return { ok: true, data: { transaction_id: data } };
}

/**
 * Tesorería's pasivo by sold checks: the contingent part (sold checks not
 * due yet; if one bounces the buyer charges it back) and the debts to
 * buyers still unpaid. Drained past max_rows: a capped sum would understate
 * the exposure.
 */
export async function getSoldChecksExposureAction(input?: {
  isFiscal?: boolean | null;
}): Promise<ActionResult<SoldChecksExposure>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "cheques:read")) {
    return { ok: false, error: READ_DENIED };
  }
  const isFiscal = scopeIsFiscalFor(ctx.access, input?.isFiscal);
  const supabase = getServiceClient();
  const today = todayInAR();
  const [sold, debts] = await Promise.all([
    paginateRange((from, to) =>
      applyFiscalFilter(
        supabase
          .from("checks")
          .select("id, amount, currency, channel:invoicing_channels(is_fiscal)")
          .eq("status", "vendido")
          .gte("due_date", today),
        isFiscal,
        "channel",
      )
        .order("id")
        .range(from, to),
    ),
    paginateRange((from, to) =>
      supabase
        .from("check_sale_debts")
        .select(
          "id, amount, currency, check:checks(channel:invoicing_channels(is_fiscal))",
        )
        .is("paid_at", null)
        .order("id")
        .range(from, to),
    ),
  ]);
  if (sold.error || debts.error) {
    logger.error("check_sales.exposure.failed", {
      userId: ctx.userId,
      error: sold.error ?? debts.error,
    });
    return { ok: false, error: "No se pudo calcular el pasivo por cheques." };
  }
  // currency is ARS/USD by CHECK; anything else is logged and left out.
  const known = <T extends { id: string; currency: string }>(
    rows: readonly T[],
  ): (T & { currency: CheckSaleCurrency })[] =>
    rows.filter((r): r is T & { currency: CheckSaleCurrency } => {
      if (isCheckSaleCurrency(r.currency)) return true;
      logger.error("check_sales.exposure.unknown_currency", { id: r.id });
      return false;
    });
  // A debt sits on its check's side (a sold check always has a channel).
  const pendingDebts = debts.data.filter(
    (d) => isFiscal === null || d.check?.channel?.is_fiscal === isFiscal,
  );
  return {
    ok: true,
    data: {
      contingent: sumByCurrency(
        known(sold.data),
        (r) => r.currency,
        (r) => Number(r.amount),
      ).map((r) => ({
        currency: r.currency,
        amount: r.amount,
        checks: r.count,
      })),
      debts: sumByCurrency(
        known(pendingDebts),
        (r) => r.currency,
        (r) => Number(r.amount),
      ),
    },
  };
}
