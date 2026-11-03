"use server";

import { z } from "zod";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { scopeIsFiscalFor, userCan } from "@/lib/auth/permissions";
import { issueLateInterestNd } from "@/lib/commands/issue-late-interest-nd";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import { issueFiscalInvoiceAction } from "@/features/invoices/actions/invoices-actions";

import { computeLateInterest } from "../lib/late-interest";
import {
  ClientRateSchema,
  GeneralRateSchema,
  IssueLateInterestBulkSchema,
  IssueLateInterestSchema,
  LateInterestListSchema,
  type ClientRateInput,
  type GeneralRateInput,
  type IssueLateInterestBulkInput,
  type IssueLateInterestInput,
  type LateInterestBulkResult,
  type LateInterestCandidate,
  type LateInterestListInput,
} from "../schema";

const GENERAL_RATE_KEY = "late_interest_monthly_rate";

type CandidateRow = {
  invoice_id: string;
  client_id: string;
  client_name: string;
  channel_id: string;
  channel_is_fiscal: boolean;
  kind: string;
  letter: string | null;
  punto_venta: number;
  numero: number | null;
  fecha: string;
  due_date: string;
  moneda: string;
  open_amount: number;
  charged_to: string | null;
  charge_from: string;
  client_rate: number | null;
  monthly_rate: number | null;
  balance_days: number;
};

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

function withPreview(row: CandidateRow, asOf: string): LateInterestCandidate {
  const rate = row.monthly_rate === null ? null : Number(row.monthly_rate);
  const open = Number(row.open_amount);
  const { days, interest } = computeLateInterest({
    balanceDays: Number(row.balance_days),
    monthlyRate: rate ?? 0,
    from: row.charge_from,
    to: asOf,
  });
  return {
    ...row,
    open_amount: open,
    balance_days: Number(row.balance_days),
    client_rate: row.client_rate === null ? null : Number(row.client_rate),
    monthly_rate: rate,
    days,
    interest,
  };
}

/**
 * Overdue comprobantes with open balance on `as_of`, each with the interest
 * its next ND would charge (from the day after the due date or after the last
 * live charge, at the client's or the general rate). Gated on invoices:read;
 * a fiscal-only user sees fiscal channels only.
 */
export async function listLateInterestCandidatesAction(
  input: LateInterestListInput,
): Promise<ActionResult<LateInterestCandidate[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "invoices:read")) {
    return { ok: false, error: "No tenés permiso para ver comprobantes." };
  }
  const parsed = LateInterestListSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const isFiscal = scopeIsFiscalFor(ctx.access, parsed.data.isFiscal);

  const supabase = getServiceClient();
  // Drained past max_rows: a truncated list would hide overdue comprobantes.
  const { data, error } = await paginateRange((from, to) => {
    let q = supabase.rpc("late_interest_candidates", {
      p_as_of: parsed.data.as_of,
    });
    if (isFiscal !== null) q = q.eq("channel_is_fiscal", isFiscal);
    return q.range(from, to);
  });
  if (error) {
    logger.error("late_interest.candidates.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudieron calcular los intereses." };
  }
  return {
    ok: true,
    data: (data ?? []).map((r) => withPreview(r, parsed.data.as_of)),
  };
}

/** The general monthly rate (null = not set). */
export async function getLateInterestGeneralRateAction(): Promise<
  ActionResult<{ monthly_rate: number | null }>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "invoices:read")) {
    return { ok: false, error: "No tenés permiso para ver comprobantes." };
  }
  const { data, error } = await getServiceClient()
    .from("finance_settings")
    .select("value")
    .eq("key", GENERAL_RATE_KEY)
    .maybeSingle();
  if (error) {
    logger.error("late_interest.general_rate.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo leer la tasa general." };
  }
  const value = data?.value;
  return {
    ok: true,
    data: { monthly_rate: typeof value === "number" ? value : null },
  };
}

/** Sets or clears the general monthly rate. Whoever issues NDs sets it. */
export async function setLateInterestGeneralRateAction(
  input: GeneralRateInput,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "credit_debit_notes:issue")) {
    return {
      ok: false,
      error: "No tenés permiso para cambiar la tasa de interés por mora.",
    };
  }
  const parsed = GeneralRateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const rate = parsed.data.monthly_rate;

  const supabase = getServiceClient();
  const { error } =
    rate === null
      ? await supabase
          .from("finance_settings")
          .delete()
          .eq("key", GENERAL_RATE_KEY)
      : await supabase.from("finance_settings").upsert({
          key: GENERAL_RATE_KEY,
          value: rate,
          updated_at: new Date().toISOString(),
          updated_by: ctx.userId,
        });
  if (error) {
    logger.error("late_interest.general_rate.set_failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo guardar la tasa general." };
  }
  await logAudit("late_interest.general_rate_set", ctx.userId, {
    monthly_rate: rate,
  });
  return { ok: true, data: undefined };
}

/** Sets or clears (back to the general one) a client's monthly rate. */
export async function setClientLateInterestRateAction(
  input: ClientRateInput,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "clients:write")) {
    return { ok: false, error: "No tenés permiso para editar clientes." };
  }
  const parsed = ClientRateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { client_id, monthly_rate } = parsed.data;

  const { data, error } = await getServiceClient()
    .from("clients")
    .update({ late_interest_monthly_rate: monthly_rate })
    .eq("id", client_id)
    .select("id");
  if (error) {
    logger.error("late_interest.client_rate.set_failed", {
      userId: ctx.userId,
      client_id,
      error,
    });
    return { ok: false, error: "No se pudo guardar la tasa del cliente." };
  }
  if (data.length === 0) {
    return { ok: false, error: "No se encontró el cliente." };
  }
  await logAudit(
    "late_interest.client_rate_set",
    ctx.userId,
    { client_id, monthly_rate },
    client_id,
  );
  return { ok: true, data: undefined };
}

/**
 * "Generar ND" for one overdue comprobante: gate, parse, then
 * issueLateInterestNd (lib/commands) through issueFiscalInvoiceAction.
 */
export async function issueLateInterestNdAction(
  input: IssueLateInterestInput,
): Promise<ActionResult<{ invoiceId: string }>> {
  const ctx = await requireUserContext();
  if (
    !userCan(ctx.access, "invoices:issue") ||
    !userCan(ctx.access, "credit_debit_notes:issue")
  ) {
    return {
      ok: false,
      error: "No tenés permiso para emitir notas de débito.",
    };
  }
  const parsed = IssueLateInterestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  return issueLateInterestNd(ctx.userId, parsed.data, issueFiscalInvoiceAction);
}

/**
 * "Generar ND" for several overdue comprobantes: one ND each, one after the
 * other through the same issueLateInterestNd (each claims its own period, so
 * a retry or a double click cannot charge a period twice). One failing does
 * not stop the rest; the result says what each one got.
 */
export async function issueLateInterestNdsBulkAction(
  input: IssueLateInterestBulkInput,
): Promise<ActionResult<LateInterestBulkResult[]>> {
  const ctx = await requireUserContext();
  if (
    !userCan(ctx.access, "invoices:issue") ||
    !userCan(ctx.access, "credit_debit_notes:issue")
  ) {
    return {
      ok: false,
      error: "No tenés permiso para emitir notas de débito.",
    };
  }
  const parsed = IssueLateInterestBulkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const results: LateInterestBulkResult[] = [];
  for (const item of parsed.data.items) {
    const res = await issueLateInterestNd(
      ctx.userId,
      { ...item, as_of: parsed.data.as_of },
      issueFiscalInvoiceAction,
    );
    results.push(
      res.ok
        ? {
            invoice_id: item.invoice_id,
            ok: true,
            nd_invoice_id: res.data.invoiceId,
          }
        : { invoice_id: item.invoice_id, ok: false, error: res.error },
    );
  }
  await logAudit("late_interest.bulk_issued", ctx.userId, {
    as_of: parsed.data.as_of,
    requested: results.length,
    issued: results.filter((r) => r.ok).length,
  });
  return { ok: true, data: results };
}
