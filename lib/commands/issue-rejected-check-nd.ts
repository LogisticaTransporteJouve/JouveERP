import "server-only";

import type { z } from "zod";

import type { IssueRejectedCheckNdSchema } from "@/features/checks/schema";
import { isIvaCondition } from "@/features/clients/schema";
import { logAudit } from "@/lib/actions/audit";
import { CONCEPTO, IVA_RATE, MONEDA, voucherReceptor } from "@/lib/afip/codes";
import { todayInAR } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

import type { IssueComprobante } from "./issue-late-interest-nd";

/** Facturas and NDs an ND can hang from (an NC cannot be its origin). */
const ORIGIN_KINDS = ["factura", "nd"];

/**
 * «Gastos a cobrarle al cliente» of a rejected third-party check: one Nota de
 * Débito to the client who gave the check, for `amount` net + IVA 21 %,
 * through `issue` (AFIP on a fiscal channel, remito interno on an internal
 * one). AFIP needs an origin comprobante: the latest live factura or ND of the
 * check's channel that the check's receipt paid, else the client's latest one
 * on that channel. The ND takes its punto de venta and currency (pesos).
 *
 * Idempotent on `idempotency_key` (one per dialog): a double submit or a retry
 * returns the same ND. The caller has checked `invoices:issue` +
 * `credit_debit_notes:issue` and parsed the input.
 */
export async function issueRejectedCheckNd(
  actorId: string,
  input: z.output<typeof IssueRejectedCheckNdSchema>,
  issue: IssueComprobante,
): Promise<ActionResult<{ invoiceId: string }>> {
  const { check_id, amount, idempotency_key } = input;
  const supabase = getServiceClient();

  const { data: check, error: checkErr } = await supabase
    .from("checks")
    .select(
      "check_number, bank_name, status, currency, channel_id, source_client_id, source_receipt_id",
    )
    .eq("id", check_id)
    .maybeSingle();
  if (checkErr || !check) {
    logger.error("rejected_check_nd.check_failed", {
      userId: actorId,
      check_id,
      error: checkErr,
    });
    return { ok: false, error: "No se pudo leer el cheque." };
  }
  if (check.status !== "rechazado") {
    return {
      ok: false,
      error: "Solo se cobran gastos de un cheque rechazado.",
    };
  }
  if (!check.source_client_id) {
    return {
      ok: false,
      error:
        "El cheque no tiene cliente: emití la nota de débito desde Ventas.",
    };
  }
  if (!check.channel_id) {
    return { ok: false, error: "El cheque no tiene canal." };
  }

  const origin = await findOrigin(supabase, {
    clientId: check.source_client_id,
    channelId: check.channel_id,
    receiptId: check.source_receipt_id,
  });
  if (!origin.ok) {
    logger.error("rejected_check_nd.origin_failed", {
      userId: actorId,
      check_id,
      error: origin.error,
    });
    return { ok: false, error: "No se pudo buscar el comprobante origen." };
  }
  if (!origin.data) {
    return {
      ok: false,
      error:
        "El cliente no tiene una factura emitida en el canal del cheque para usar de origen: emití la nota de débito desde Ventas.",
    };
  }

  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("cuit, iva_condition")
    .eq("id", check.source_client_id)
    .maybeSingle();
  if (clientErr || !client) {
    logger.error("rejected_check_nd.client_failed", {
      userId: actorId,
      check_id,
      error: clientErr,
    });
    return { ok: false, error: "No se pudo leer el cliente." };
  }
  const ivaCondition = isIvaCondition(client.iva_condition)
    ? client.iva_condition
    : null;

  const today = todayInAR();
  const result = await issue({
    channel_id: check.channel_id,
    client_id: check.source_client_id,
    kind: "nd",
    letter: null,
    punto_venta: origin.data.punto_venta,
    fecha: today,
    fch_serv_desde: today,
    fch_serv_hasta: today,
    fch_vto_pago: today,
    concepto: CONCEPTO.SERVICIOS,
    ...voucherReceptor({ cuit: client.cuit, iva_condition: ivaCondition }),
    moneda: MONEDA.PESOS,
    cotizacion: 1,
    invoice_origin_id: origin.data.id,
    motivo_nc_nd: "Gastos por cheque rechazado",
    items: [
      {
        description: `Gastos por cheque rechazado N.º ${check.check_number}${
          check.bank_name ? ` (${check.bank_name})` : ""
        }`,
        quantity: 1,
        unit_price: amount,
        iva_rate_id: IVA_RATE.TWENTY_ONE,
      },
    ],
    idempotency_key,
  });
  if (!result.ok) return result;

  await logAudit(
    "check.rejection_nd_issued",
    actorId,
    { nd_invoice_id: result.data.id, origin_id: origin.data.id, amount },
    check_id,
  );
  return { ok: true, data: { invoiceId: result.data.id } };
}

type Origin = { id: string; punto_venta: number };
type OriginResult =
  { ok: true; data: Origin | null } | { ok: false; error: unknown };

async function findOrigin(
  supabase: ReturnType<typeof getServiceClient>,
  args: { clientId: string; channelId: string; receiptId: string | null },
): Promise<OriginResult> {
  const base = () =>
    supabase
      .from("invoices")
      .select("id, punto_venta")
      .eq("client_id", args.clientId)
      .eq("channel_id", args.channelId)
      .eq("status", "emitted")
      .eq("moneda", MONEDA.PESOS)
      .in("kind", ORIGIN_KINDS)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);

  if (args.receiptId) {
    const { data: allocs, error } = await supabase
      .from("receipt_allocations")
      .select("invoice_id")
      .eq("receipt_id", args.receiptId);
    if (error) return { ok: false, error };
    const ids = (allocs ?? []).map((a) => a.invoice_id);
    if (ids.length > 0) {
      const { data, error: paidErr } = await base().in("id", ids);
      if (paidErr) return { ok: false, error: paidErr };
      if (data?.[0]) return { ok: true, data: data[0] };
    }
  }
  const { data, error } = await base();
  if (error) return { ok: false, error };
  return { ok: true, data: data?.[0] ?? null };
}
