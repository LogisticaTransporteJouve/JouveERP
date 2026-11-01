"use server";

import { z } from "zod";

import { isIvaCondition } from "@/features/clients/schema";
import { IVA_RATE, voucherReceptor, type IvaRateId } from "@/lib/afip/codes";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { todayInAR } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

import { formatInvoiceNumero } from "../schema";
import {
  issueFiscalInvoiceAction,
  type IssueInvoiceResult,
} from "./invoices-actions";

const IVA_RATE_IDS = Object.values(IVA_RATE);

const BillRemitoInput = z.object({
  remito_id: z.string().uuid(),
  client_id: z.string().uuid(),
  channel_id: z.string().min(1),
  punto_venta: z.number().int().positive(),
  iva_rate_id: z
    .number()
    .int()
    .refine((v): v is IvaRateId => IVA_RATE_IDS.some((r) => r === v), {
      message: "Alícuota de IVA inválida.",
    }),
  idempotency_key: z.string().uuid(),
});

/**
 * Bills a remito interno of Otras ventas on a fiscal factura: same items, the
 * remito's price as the net, plus IVA. Once AFIP authorizes the factura the
 * issue workflow credits the remito with a nota de crédito interna
 * (lib/inngest/functions/credit-billed-remito.ts), so the sale is counted once.
 */
export async function billRemitoAction(
  input: z.input<typeof BillRemitoInput>,
): Promise<ActionResult<IssueInvoiceResult>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "invoices:issue")) {
    return { ok: false, error: "No tenés permiso para emitir comprobantes." };
  }
  const parsed = BillRemitoInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const data = parsed.data;
  const supabase = getServiceClient();

  const { data: remito, error: remitoErr } = await supabase
    .from("invoices")
    .select(
      "id, kind, status, concepto, imp_total, channel:invoicing_channels(is_fiscal), items:invoice_items(description, quantity, unit_price, sort_order)",
    )
    .eq("id", data.remito_id)
    .maybeSingle();
  if (remitoErr) {
    logger.error("bill_remito.load_failed", { error: remitoErr });
    return { ok: false, error: "No se pudo leer el remito." };
  }
  if (
    !remito ||
    remito.kind !== "factura" ||
    remito.channel?.is_fiscal !== false
  ) {
    return { ok: false, error: "Solo se puede facturar un remito interno." };
  }
  if (remito.status !== "emitted") {
    return { ok: false, error: "El remito todavía no está emitido." };
  }

  // A prior NC already credits the remito: billing it would count it twice.
  const ncs = await supabase
    .from("invoices")
    .select("id")
    .eq("invoice_origin_id", remito.id)
    .in("status", ["draft", "emitting", "emitted"])
    .limit(1);
  if (ncs.error) {
    logger.error("bill_remito.balance_failed", { error: ncs.error });
    return { ok: false, error: "No se pudo verificar el saldo del remito." };
  }
  if ((ncs.data ?? []).length > 0) {
    return {
      ok: false,
      error: "El remito ya tiene una nota de crédito: no se puede facturar.",
    };
  }

  // Recibos internos already applied pass to the fiscal side once the factura
  // is emitted (move_billed_remito_receipts). Only the ones that can move
  // whole: applied to this remito alone, in pesos, without cheques or
  // retentions.
  const blocker = await receiptMoveBlocker(supabase, remito.id);
  if (blocker) return { ok: false, error: blocker };

  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, cuit, iva_condition, is_fiscal")
    .eq("id", data.client_id)
    .maybeSingle();
  if (clientErr || !client) {
    return { ok: false, error: "No se encontró el cliente." };
  }
  if (
    !client.is_fiscal ||
    !client.cuit ||
    !isIvaCondition(client.iva_condition)
  ) {
    return {
      ok: false,
      error: "Elegí un cliente de Ventas, con CUIT y condición de IVA.",
    };
  }

  const items = [...(remito.items ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((it) => ({
      description: it.description,
      quantity: Number(it.quantity),
      unit_price: Number(it.unit_price),
      iva_rate_id: data.iva_rate_id,
    }));
  if (items.length === 0) {
    return { ok: false, error: "El remito no tiene ítems." };
  }

  const fecha = todayInAR();
  return issueFiscalInvoiceAction({
    channel_id: data.channel_id,
    client_id: client.id,
    kind: "factura",
    letter: null,
    punto_venta: data.punto_venta,
    fecha,
    fch_serv_desde: fecha,
    fch_serv_hasta: fecha,
    fch_vto_pago: fecha,
    // Productos (1) or productos y servicios (3) as on the remito; else servicios.
    concepto:
      remito.concepto === 1 || remito.concepto === 3 ? remito.concepto : 2,
    ...voucherReceptor({
      cuit: client.cuit,
      iva_condition: client.iva_condition,
    }),
    moneda: "PES",
    cotizacion: 1,
    source_remito_id: remito.id,
    items,
    idempotency_key: data.idempotency_key,
  });
}

async function receiptMoveBlocker(
  supabase: ReturnType<typeof getServiceClient>,
  remitoId: string,
): Promise<string | null> {
  const { data: allocs, error } = await supabase
    .from("receipt_allocations")
    .select("receipt_id, receipt:receipts!inner(status, currency, numero)")
    .eq("invoice_id", remitoId)
    .eq("receipt.status", "issued");
  if (error) {
    logger.error("bill_remito.receipts_failed", { error });
    return "No se pudieron verificar los cobros del remito.";
  }
  const receiptIds = [...new Set((allocs ?? []).map((a) => a.receipt_id))];
  if (receiptIds.length === 0) return null;
  if ((allocs ?? []).some((a) => a.receipt?.currency !== "ARS")) {
    return "El remito tiene un cobro en otra moneda: anulá ese recibo interno y cargá el cobro en Ventas.";
  }

  const [otherAllocs, rejected, retentions, cheques] = await Promise.all([
    supabase
      .from("receipt_allocations")
      .select("id")
      .in("receipt_id", receiptIds)
      .neq("invoice_id", remitoId)
      .limit(1),
    supabase
      .from("receipt_rejected_check_allocations")
      .select("id")
      .in("receipt_id", receiptIds)
      .limit(1),
    supabase
      .from("receipt_retentions")
      .select("id")
      .in("receipt_id", receiptIds)
      .limit(1),
    supabase
      .from("checks")
      .select("id")
      .in("source_receipt_id", receiptIds)
      .limit(1),
  ]);
  const failed =
    otherAllocs.error ?? rejected.error ?? retentions.error ?? cheques.error;
  if (failed) {
    logger.error("bill_remito.receipts_failed", { error: failed });
    return "No se pudieron verificar los cobros del remito.";
  }
  if ((otherAllocs.data ?? []).length > 0 || (rejected.data ?? []).length > 0) {
    return "Un recibo interno de este remito también paga otros comprobantes: anulalo, facturá el remito y cargá el cobro en Ventas.";
  }
  if ((cheques.data ?? []).length > 0) {
    return "El remito se cobró con cheques: anulá ese recibo interno, facturá el remito y cargá el cobro en Ventas.";
  }
  if ((retentions.data ?? []).length > 0) {
    return "El cobro del remito tiene retenciones: anulá ese recibo interno, facturá el remito y cargá el cobro en Ventas.";
  }
  return null;
}

export interface RemitoLinks {
  /** On a remito: the live factura it was billed on. */
  billedAs: { id: string; label: string } | null;
  /** On a factura: the remito interno it billed. */
  sourceRemito: { id: string; label: string } | null;
}

export async function getRemitoLinksAction(
  invoiceId: string,
): Promise<ActionResult<RemitoLinks>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "invoices:read")) {
    return { ok: false, error: "No tenés permiso para ver comprobantes." };
  }
  const id = z.string().uuid().safeParse(invoiceId);
  if (!id.success) return { ok: false, error: "Comprobante inválido." };

  const supabase = getServiceClient();
  const cols = "id, kind, letter, punto_venta, numero, source_remito_id";
  const [billed, self] = await Promise.all([
    supabase
      .from("invoices")
      .select(cols)
      .eq("source_remito_id", id.data)
      .not("status", "in", "(failed,cancelled)")
      .maybeSingle(),
    supabase.from("invoices").select(cols).eq("id", id.data).maybeSingle(),
  ]);
  if (billed.error || self.error) {
    return { ok: false, error: "No se pudieron leer los vínculos." };
  }

  let sourceRemito: RemitoLinks["sourceRemito"] = null;
  if (self.data?.source_remito_id) {
    const { data: remito } = await supabase
      .from("invoices")
      .select(cols)
      .eq("id", self.data.source_remito_id)
      .maybeSingle();
    if (remito) {
      sourceRemito = {
        id: remito.id,
        label: formatInvoiceNumero(
          remito.kind,
          remito.letter,
          remito.punto_venta,
          remito.numero,
        ),
      };
    }
  }

  return {
    ok: true,
    data: {
      billedAs: billed.data
        ? {
            id: billed.data.id,
            label: formatInvoiceNumero(
              billed.data.kind,
              billed.data.letter,
              billed.data.punto_venta,
              billed.data.numero,
              { whenNullNumero: "en emisión" },
            ),
          }
        : null,
      sourceRemito,
    },
  };
}
