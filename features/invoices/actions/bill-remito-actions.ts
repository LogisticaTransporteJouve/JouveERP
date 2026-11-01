"use server";

import { z } from "zod";

import { isIvaCondition } from "@/features/clients/schema";
import { IVA_RATE, voucherReceptor, type IvaRateId } from "@/lib/afip/codes";
import { requireUserContext } from "@/lib/auth/context";
import { isFiscalOnly, userCan } from "@/lib/auth/permissions";
import { todayInAR } from "@/lib/format";
import { inngest } from "@/lib/inngest/client";
import { INVOICE_REMITO_BILLED } from "@/lib/inngest/events";
import { logAudit } from "@/lib/actions/audit";
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

  // What keeps a remito from being billed lives in the DB
  // (billed_remito_blocker), which checks it again when the factura is drafted
  // and when it is settled: a prior NC or ajuste de saldo, or recibos internos
  // that cannot move whole to the fiscal side.
  const blocker = await supabase.rpc("billed_remito_blocker", {
    p_remito_id: remito.id,
  });
  if (blocker.error) {
    logger.error("bill_remito.blocker_failed", { error: blocker.error });
    return { ok: false, error: "No se pudo verificar el saldo del remito." };
  }
  if (blocker.data) return { ok: false, error: blocker.data };

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

export interface RemitoLinks {
  /** On a remito: the live factura it was billed on. */
  billedAs: { id: string; label: string } | null;
  /** On a factura: the remito interno it billed. */
  sourceRemito: { id: string; label: string } | null;
  /** On an emitted factura that billed a remito, while its NC interna is not
   *  emitted: settling right after the CAE ("running"), or stuck long enough
   *  to need "Reintentar acreditación" ("pending"). */
  creditState: "settled" | "running" | "pending";
}

const NO_LINKS: RemitoLinks = {
  billedAs: null,
  sourceRemito: null,
  creditState: "settled",
};

/** How long after the CAE a settlement still counts as running: the job
 *  retries for a few minutes before giving up. */
const SETTLE_WINDOW_MS = 10 * 60 * 1000;

function creditStateOf(
  factura: {
    status: string;
    emitted_at: string | null;
    source_remito_id: string | null;
  } | null,
  nc: { status: string } | null,
): RemitoLinks["creditState"] {
  if (!factura?.source_remito_id || factura.status !== "emitted") {
    return "settled";
  }
  if (nc?.status === "emitted") return "settled";
  if (nc?.status === "draft" || nc?.status === "emitting") return "running";
  const emittedAt = factura.emitted_at ? Date.parse(factura.emitted_at) : 0;
  return Date.now() - emittedAt < SETTLE_WINDOW_MS ? "running" : "pending";
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
  // Every link points at a remito interno: a fiscal-only user sees none.
  if (isFiscalOnly(ctx.access)) return { ok: true, data: NO_LINKS };

  const supabase = getServiceClient();
  const cols =
    "id, kind, letter, punto_venta, numero, status, emitted_at, source_remito_id";
  const [billed, self, nc] = await Promise.all([
    supabase
      .from("invoices")
      .select(cols)
      .eq("source_remito_id", id.data)
      .not("status", "in", "(failed,cancelled)")
      .maybeSingle(),
    supabase.from("invoices").select(cols).eq("id", id.data).maybeSingle(),
    supabase
      .from("invoices")
      .select("id, status")
      .eq("idempotency_key", id.data)
      .maybeSingle(),
  ]);
  const failed = billed.error ?? self.error ?? nc.error;
  if (failed) {
    logger.error("bill_remito.links_failed", {
      invoiceId: id.data,
      error: failed,
    });
    return { ok: false, error: "No se pudieron leer los vínculos del remito." };
  }

  let sourceRemito: RemitoLinks["sourceRemito"] = null;
  if (self.data?.source_remito_id) {
    const remito = await supabase
      .from("invoices")
      .select(cols)
      .eq("id", self.data.source_remito_id)
      .maybeSingle();
    if (remito.error) {
      logger.error("bill_remito.links_failed", {
        invoiceId: id.data,
        error: remito.error,
      });
      return {
        ok: false,
        error: "No se pudieron leer los vínculos del remito.",
      };
    }
    if (remito.data) {
      sourceRemito = {
        id: remito.data.id,
        label: formatInvoiceNumero(
          remito.data.kind,
          remito.data.letter,
          remito.data.punto_venta,
          remito.data.numero,
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
      creditState: creditStateOf(self.data, nc.data),
    },
  };
}

/** Re-runs the settlement of a billed remito (credit-billed-remito) when the
 *  factura is emitted but the remito was not credited. */
export async function retryRemitoCreditAction(
  facturaId: string,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "invoices:issue")) {
    return { ok: false, error: "No tenés permiso para emitir comprobantes." };
  }
  const id = z.string().uuid().safeParse(facturaId);
  if (!id.success) return { ok: false, error: "Comprobante inválido." };

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("id, status, source_remito_id")
    .eq("id", id.data)
    .maybeSingle();
  if (error) {
    logger.error("bill_remito.retry_load_failed", {
      facturaId: id.data,
      error,
    });
    return { ok: false, error: "No se pudo leer la factura." };
  }
  if (!data?.source_remito_id || data.status !== "emitted") {
    return {
      ok: false,
      error:
        "Solo una factura emitida que facturó un remito se puede acreditar.",
    };
  }
  // A refusal the settlement would hit again: say it instead of re-queueing.
  // (The settlement's own NC, failed or pending, is what the retry fixes.)
  const blocker = await supabase.rpc("billed_remito_blocker", {
    p_remito_id: data.source_remito_id,
  });
  if (blocker.error) {
    logger.error("bill_remito.blocker_failed", { error: blocker.error });
    return { ok: false, error: "No se pudo verificar el remito." };
  }
  if (blocker.data && !blocker.data.startsWith("El remito ya tiene una nota")) {
    return { ok: false, error: blocker.data };
  }
  try {
    await inngest.send({
      name: INVOICE_REMITO_BILLED,
      data: { factura_id: data.id },
    });
  } catch (err) {
    logger.error("bill_remito.retry_enqueue_failed", {
      factura_id: data.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error: "No se pudo encolar la acreditación. Probá de nuevo.",
    };
  }
  await logAudit("invoice.remito_credit_retried", ctx.userId, {}, data.id);
  logger.info("bill_remito.credit_retried", {
    userId: ctx.userId,
    factura_id: data.id,
  });
  return { ok: true, data: undefined };
}
