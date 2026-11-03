"use server";

import { z } from "zod";

import { logAudit } from "@/lib/actions/audit";
import { CONCEPTO, IVA_RATE, MONEDA, voucherReceptor } from "@/lib/afip/codes";
import { requireUserContext } from "@/lib/auth/context";
import { scopeIsFiscalFor, userCan } from "@/lib/auth/permissions";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { todayInAR } from "@/lib/format";
import { fetchUsdRateOnOrBefore } from "@/lib/fx";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import { isIvaCondition } from "@/features/clients/schema";
import { issueFiscalInvoiceAction } from "@/features/invoices/actions/invoices-actions";

import {
  computeLateInterest,
  lateInterestDescription,
} from "../lib/late-interest";
import {
  ClientRateSchema,
  GeneralRateSchema,
  IssueLateInterestSchema,
  LateInterestListSchema,
  type ClientRateInput,
  type GeneralRateInput,
  type IssueLateInterestInput,
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
};

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

function withPreview(row: CandidateRow, asOf: string): LateInterestCandidate {
  const rate = row.monthly_rate === null ? null : Number(row.monthly_rate);
  const open = Number(row.open_amount);
  const { days, interest } = computeLateInterest({
    openAmount: open,
    monthlyRate: rate ?? 0,
    from: row.charge_from,
    to: asOf,
  });
  return {
    ...row,
    open_amount: open,
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
 * "Generar ND": one Nota de Débito for the interest of one overdue
 * comprobante, from the day after its due date (or after the last live
 * charge) to `as_of`, through issueFiscalInvoiceAction (AFIP on a fiscal
 * channel, remito interno on an internal one). The charge row is claimed
 * first: the guard refuses a period already charged, so two clicks cannot
 * both charge it. The ND carries the charge id as idempotency key (a retry
 * returns the same ND) and is linked on success; a failure releases the
 * charge, and so does the ND failing or being cancelled later
 * (invoices_release_late_interest).
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
  const { invoice_id, as_of, monthly_rate, punto_venta } = parsed.data;
  const today = todayInAR();
  if (as_of > today) {
    return { ok: false, error: "No se cobran intereses de días futuros." };
  }

  const supabase = getServiceClient();
  const { data: rows, error: rowErr } = await supabase
    .rpc("late_interest_candidates", { p_as_of: as_of })
    .eq("invoice_id", invoice_id);
  if (rowErr) {
    logger.error("late_interest.issue.read_failed", {
      userId: ctx.userId,
      invoice_id,
      error: rowErr,
    });
    return { ok: false, error: "No se pudo leer el comprobante." };
  }
  const row = rows?.[0];
  if (!row) {
    return {
      ok: false,
      error: "El comprobante no está vencido o no tiene saldo abierto.",
    };
  }
  const { days, interest } = computeLateInterest({
    openAmount: Number(row.open_amount),
    monthlyRate: monthly_rate,
    from: row.charge_from,
    to: as_of,
  });
  if (days === 0) {
    return {
      ok: false,
      error: "Ya se cobraron los intereses hasta esa fecha.",
    };
  }
  if (interest <= 0) {
    return { ok: false, error: "El interés da cero: no hay nada que cobrar." };
  }

  const clientRes = await supabase
    .from("clients")
    .select("cuit, iva_condition, is_fiscal")
    .eq("id", row.client_id)
    .maybeSingle();
  if (clientRes.error || !clientRes.data) {
    logger.error("late_interest.issue.client_failed", {
      userId: ctx.userId,
      invoice_id,
      error: clientRes.error,
    });
    return { ok: false, error: "No se pudo leer el cliente." };
  }
  const client = clientRes.data;
  const ivaCondition = isIvaCondition(client.iva_condition)
    ? client.iva_condition
    : null;

  // A note in dollars needs the day's rate (fiscalVoucherIssue).
  let cotizacion = 1;
  if (row.moneda !== MONEDA.PESOS) {
    const usd = await fetchUsdRateOnOrBefore(supabase, today);
    if (!usd) {
      return {
        ok: false,
        error:
          "Falta la cotización del dólar de hoy para la nota en dólares. Cargala en Contabilidad › Cotización USD.",
      };
    }
    cotizacion = usd.rate;
  }

  const claim = await supabase
    .from("late_interest_charges")
    .insert({
      invoice_id,
      client_id: row.client_id,
      period_from: row.charge_from,
      period_to: as_of,
      monthly_rate,
      base_amount: Number(row.open_amount),
      interest_amount: interest,
      moneda: row.moneda,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (claim.error || !claim.data) {
    const guard = mapDbGuardError(claim.error, {
      slug: "late_interest.issue.claim_rejected",
      userId: ctx.userId,
      id: invoice_id,
    });
    if (guard) return { ok: false, error: guard };
    logger.error("late_interest.issue.claim_failed", {
      userId: ctx.userId,
      invoice_id,
      error: claim.error,
    });
    return { ok: false, error: "No se pudo registrar el interés." };
  }
  const chargeId = claim.data.id;

  const result = await issueFiscalInvoiceAction({
    channel_id: row.channel_id,
    client_id: row.client_id,
    kind: "nd",
    letter: null,
    punto_venta,
    fecha: today,
    fch_serv_desde: row.charge_from,
    fch_serv_hasta: as_of,
    fch_vto_pago: today,
    concepto: CONCEPTO.SERVICIOS,
    ...voucherReceptor({ cuit: client.cuit, iva_condition: ivaCondition }),
    moneda: row.moneda === MONEDA.PESOS ? MONEDA.PESOS : MONEDA.DOLARES,
    cotizacion,
    invoice_origin_id: invoice_id,
    motivo_nc_nd: "Intereses por mora",
    items: [
      {
        description: lateInterestDescription({
          ...row,
          from: row.charge_from,
          to: as_of,
          days,
          monthlyRate: monthly_rate,
        }),
        quantity: 1,
        unit_price: interest,
        iva_rate_id: IVA_RATE.TWENTY_ONE,
      },
    ],
    idempotency_key: chargeId,
  });
  if (!result.ok) {
    const { error: releaseErr } = await supabase
      .from("late_interest_charges")
      .update({ released: true })
      .eq("id", chargeId)
      .is("nd_invoice_id", null);
    if (releaseErr) {
      logger.error("late_interest.issue.release_failed", {
        userId: ctx.userId,
        chargeId,
        error: releaseErr,
      });
    }
    return result;
  }

  const { error: linkErr } = await supabase
    .from("late_interest_charges")
    .update({ nd_invoice_id: result.data.id })
    .eq("id", chargeId);
  if (linkErr) {
    logger.error("late_interest.issue.link_failed", {
      userId: ctx.userId,
      chargeId,
      invoiceId: result.data.id,
      error: linkErr,
    });
    const guard = mapDbGuardError(linkErr, {
      slug: "late_interest.issue.link_rejected",
      userId: ctx.userId,
      id: chargeId,
    });
    // The guard refuses an ND that already failed: free the period. Any
    // other error keeps it held while the ND exists (its idempotency key is
    // the charge id), so a retry cannot charge it twice.
    if (guard) {
      await supabase
        .from("late_interest_charges")
        .update({ released: true })
        .eq("id", chargeId)
        .is("nd_invoice_id", null);
      return { ok: false, error: guard };
    }
    return {
      ok: false,
      error:
        "La nota de débito se emitió pero no se vinculó al interés. Revisala en Comprobantes antes de volver a generarla.",
    };
  }

  await logAudit(
    "late_interest.nd_issued",
    ctx.userId,
    {
      invoice_id,
      nd_invoice_id: result.data.id,
      period_from: row.charge_from,
      period_to: as_of,
      days,
      monthly_rate,
      interest,
    },
    chargeId,
  );
  return { ok: true, data: { invoiceId: result.data.id } };
}
