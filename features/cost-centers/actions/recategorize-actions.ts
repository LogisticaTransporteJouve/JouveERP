"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import {
  recategorizeExpense,
  type RecategorizeExpenseOutcome,
} from "@/lib/commands/recategorize-expense";
import { formatArgentineDate, formatMoney } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

import { formatInvoiceNumber } from "@/features/purchase-invoices/schema";

import {
  EXPENSE_SOURCE_READ,
  EXPENSE_SOURCE_WRITE,
  ExpenseRefSchema,
  RecategorizeExpenseSchema,
  type ExpenseCostTags,
} from "../schema";

const READ_DENIED = "No tenés permiso para ver ese gasto.";
const WRITE_DENIED = "No tenés permiso para recategorizar ese gasto.";

/** "PES" / "DOL" (a purchase) or "ARS" / "USD" (a movement) → the app's. */
function currencyCode(moneda: string): "ARS" | "USD" {
  return moneda === "DOL" || moneda === "USD" ? "USD" : "ARS";
}

function short(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * An expense's current expense account and cost center, and what it is (for
 * the recategorize dialog and the assistant's proposal). `blocked` says why
 * the database would refuse recategorizing it; a closed period is left to
 * the database.
 */
export async function getExpenseCostTagsAction(
  input: unknown,
): Promise<ActionResult<ExpenseCostTags>> {
  const ctx = await requireUserContext();
  const parsed = ExpenseRefSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { source, id } = parsed.data;
  if (!userCan(ctx.access, EXPENSE_SOURCE_READ[source])) {
    return { ok: false, error: READ_DENIED };
  }
  const service = getServiceClient();

  if (source === "transactions") {
    const { data, error } = await service
      .from("v_transactions_tagged")
      .select(
        "id, kind, description, amount, currency, transaction_date, expense_account_id, cost_center_id, source_document, transfer_pair_id",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) {
      logger.error("expense.cost_tags.read_failed", {
        userId: ctx.userId,
        id,
        error,
      });
      return { ok: false, error: "No se pudo leer el movimiento." };
    }
    if (!data) return { ok: false, error: "No se encontró el movimiento." };
    const blocked =
      data.kind !== "expense"
        ? "Solo se recategoriza un egreso."
        : data.source_document !== null || data.transfer_pair_id !== null
          ? "El egreso lo generó un documento: recategorizalo desde el documento de origen."
          : null;
    return {
      ok: true,
      data: {
        source,
        id,
        label: [
          formatArgentineDate(data.transaction_date),
          short(data.description ?? "Movimiento"),
          formatMoney(data.amount, currencyCode(data.currency ?? "ARS")),
        ].join(" · "),
        expense_account_id: data.expense_account_id,
        cost_center_id: data.cost_center_id,
        blocked,
      },
    };
  }

  const { data, error } = await service
    .from("purchase_invoices")
    .select(
      "id, kind, letter, punto_venta, numero, fecha, imp_neto, moneda, status, account_id, cost_center_id, suppliers!inner(legal_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    logger.error("expense.cost_tags.read_failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo leer la compra." };
  }
  if (!data) return { ok: false, error: "No se encontró la compra." };
  return {
    ok: true,
    data: {
      source,
      id,
      label: [
        formatInvoiceNumber(data),
        short(data.suppliers.legal_name),
        formatArgentineDate(data.fecha),
        `neto ${formatMoney(data.imp_neto, currencyCode(data.moneda))}`,
      ].join(" · "),
      expense_account_id: data.account_id,
      cost_center_id: data.cost_center_id,
      blocked:
        data.status !== "received"
          ? "La compra está anulada: no se recategoriza."
          : null,
    },
  };
}

/**
 * Changes the expense account and/or cost center of a manual expense or a
 * purchase, with the permission that edits that source. The database guards
 * (owned movement, annulled purchase, closed period, postable account) and
 * the re-post run in lib/commands/recategorize-expense.ts, which audits it.
 */
export async function recategorizeExpenseAction(
  input: unknown,
): Promise<ActionResult<RecategorizeExpenseOutcome>> {
  const ctx = await requireUserContext();
  const parsed = RecategorizeExpenseSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  if (!userCan(ctx.access, EXPENSE_SOURCE_WRITE[parsed.data.source])) {
    return { ok: false, error: WRITE_DENIED };
  }
  return recategorizeExpense(ctx.userId, parsed.data);
}
