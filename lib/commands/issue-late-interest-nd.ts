import "server-only";

import type { z } from "zod";

import { isIvaCondition } from "@/features/clients/schema";
import type { CreateComprobanteInput } from "@/features/invoices/schema";
import {
  computeLateInterest,
  lateInterestDescription,
} from "@/features/late-interest/lib/late-interest";
import type { IssueLateInterestSchema } from "@/features/late-interest/schema";
import { logAudit } from "@/lib/actions/audit";
import { CONCEPTO, IVA_RATE, MONEDA, voucherReceptor } from "@/lib/afip/codes";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { todayInAR } from "@/lib/format";
import { fetchUsdRateOnOrBefore } from "@/lib/fx";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

/** The comprobante issuer the ND goes through: issueFiscalInvoiceAction,
 *  injected so lib/ never imports a feature's action. */
export type IssueComprobante = (
  input: CreateComprobanteInput,
) => Promise<ActionResult<{ id: string }>>;

/**
 * "Generar ND": one Nota de Débito for the interest of one overdue
 * comprobante, from the day after its due date (or after the last live
 * charge) to `as_of`, through `issue` (AFIP on a fiscal channel, remito
 * interno on an internal one). The charge row is claimed first: the guard
 * refuses a period already charged, so two clicks cannot both charge it. The
 * ND carries the charge id as idempotency key (a retry returns the same ND)
 * and is linked on success; a failure releases the charge, and so does the ND
 * failing or being cancelled later (invoices_release_late_interest).
 *
 * The caller has already checked `invoices:issue` + `credit_debit_notes:issue`
 * and parsed the input with `IssueLateInterestSchema`: the late-interest page
 * and an accepted assistant proposal. `expectedInterest` (the proposal's
 * figure) refuses to issue when the interest changed since the user saw it,
 * e.g. a payment came in.
 */
export async function issueLateInterestNd(
  actorId: string,
  input: z.output<typeof IssueLateInterestSchema>,
  issue: IssueComprobante,
  expectedInterest?: number,
): Promise<ActionResult<{ invoiceId: string }>> {
  const { invoice_id, as_of, monthly_rate, punto_venta } = input;
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
      userId: actorId,
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
  if (
    expectedInterest !== undefined &&
    Math.abs(interest - expectedInterest) > 0.005
  ) {
    return {
      ok: false,
      error:
        "El interés cambió desde la propuesta (cambió el saldo o lo ya cobrado). Volvé a generarla para ver el importe actual.",
    };
  }

  const clientRes = await supabase
    .from("clients")
    .select("cuit, iva_condition, is_fiscal")
    .eq("id", row.client_id)
    .maybeSingle();
  if (clientRes.error || !clientRes.data) {
    logger.error("late_interest.issue.client_failed", {
      userId: actorId,
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
      created_by: actorId,
    })
    .select("id")
    .single();
  if (claim.error || !claim.data) {
    const guard = mapDbGuardError(claim.error, {
      slug: "late_interest.issue.claim_rejected",
      userId: actorId,
      id: invoice_id,
    });
    if (guard) return { ok: false, error: guard };
    logger.error("late_interest.issue.claim_failed", {
      userId: actorId,
      invoice_id,
      error: claim.error,
    });
    return { ok: false, error: "No se pudo registrar el interés." };
  }
  const chargeId = claim.data.id;

  const result = await issue({
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
        userId: actorId,
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
      userId: actorId,
      chargeId,
      invoiceId: result.data.id,
      error: linkErr,
    });
    const guard = mapDbGuardError(linkErr, {
      slug: "late_interest.issue.link_rejected",
      userId: actorId,
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
    actorId,
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
