import "server-only";

import { randomUUID } from "node:crypto";

import type { z } from "zod";

import { isIvaCondition, type IvaCondition } from "@/features/clients/schema";
import {
  computeLineAmounts,
  computeTotals,
  isInvoiceLetter,
  isInvoiceStatus,
  type CreateComprobanteSchema,
  type InvoiceRow,
} from "@/features/invoices/schema";
import { logAudit } from "@/lib/actions/audit";
import {
  cbteTipoFor,
  isCondicionIvaReceptorCode,
  letterFor,
  MONEDA,
  voucherReceptor,
  type CbteTipoCode,
  type CondicionIvaReceptorCode,
  type InvoiceLetter,
} from "@/lib/afip/codes";
import { fiscalVoucherIssue } from "@/lib/afip/rules";
import type { Database } from "@/lib/db/database.types";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { formatMoney, todayInAR } from "@/lib/format";
import { paymentCurrencyOf } from "@/lib/fx";
import { inngest } from "@/lib/inngest/client";
import { INVOICE_ISSUE_REQUESTED } from "@/lib/inngest/events";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

type ComprobanteDraft = Database["public"]["Tables"]["invoices"]["Insert"];
/** An item of create_invoice_draft, which sets its invoice_id. */
type ComprobanteItemDraft = Omit<
  Database["public"]["Tables"]["invoice_items"]["Insert"],
  "invoice_id"
>;

export interface IssueInvoiceResult {
  id: string;
  idempotency_key: string;
  status: InvoiceRow["status"];
}

interface ChannelInfo {
  id: string;
  is_fiscal: boolean;
  is_active: boolean;
}

interface ClientInfo {
  id: string;
  is_active: boolean;
  /** Null for an Otras ventas client (no IVA condition). */
  iva_condition: IvaCondition | null;
  is_fiscal: boolean;
  cuit: string | null;
}

/** The loaders below return "error" on a DB failure (logged here), so the
 *  command answers `{ ok: false }` instead of throwing. */
async function loadChannel(
  supabase: ReturnType<typeof getServiceClient>,
  channelId: string,
): Promise<ChannelInfo | null | "error"> {
  const { data, error } = await supabase
    .from("invoicing_channels")
    .select("id, is_fiscal, is_active")
    .eq("id", channelId)
    .maybeSingle();
  if (error) {
    logger.error("issue_invoice.load_channel_failed", { channelId, error });
    return "error";
  }
  return data;
}

async function loadClient(
  supabase: ReturnType<typeof getServiceClient>,
  clientId: string,
): Promise<ClientInfo | null | "error"> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, is_active, iva_condition, is_fiscal, cuit")
    .eq("id", clientId)
    .maybeSingle();
  if (error) {
    logger.error("issue_invoice.load_client_failed", { clientId, error });
    return "error";
  }
  if (!data) return null;
  return {
    id: data.id,
    is_active: data.is_active,
    iva_condition: isIvaCondition(data.iva_condition)
      ? data.iva_condition
      : null,
    is_fiscal: data.is_fiscal,
    cuit: data.cuit,
  };
}

async function loadEnabledPos(
  supabase: ReturnType<typeof getServiceClient>,
  numero: number,
  channelId: string,
): Promise<{ numero: number; channel_id: string | null } | null | "error"> {
  const { data, error } = await supabase
    .from("sales_points")
    .select("numero, channel_id, is_enabled")
    .eq("numero", numero)
    .maybeSingle();
  if (error) {
    logger.error("issue_invoice.load_pos_failed", { numero, error });
    return "error";
  }
  if (!data) return null;
  if (!data.is_enabled) return null;
  if (data.channel_id !== channelId) return null;
  return { numero: data.numero, channel_id: data.channel_id };
}

/** Queues the emission of a draft. issue-invoice dedupes on the key for 24 h,
 *  so sending again for a draft whose run already started is a no-op. A failed
 *  send is only logged: its outcome is unknown (Inngest may have accepted
 *  it), the draft is kept, and issue-invoice-reconcile sends it again. */
async function enqueueIssue(
  userId: string,
  draft: {
    invoice_id: string;
    idempotency_key: string;
    channel_id: string;
    punto_venta: number;
  },
): Promise<void> {
  try {
    await inngest.send({ name: INVOICE_ISSUE_REQUESTED, data: draft });
  } catch (err) {
    logger.error("issue_invoice.enqueue_failed", {
      userId,
      invoice_id: draft.invoice_id,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

async function findIssuedByKey(
  supabase: ReturnType<typeof getServiceClient>,
  idempotencyKey: string,
  userId: string,
): Promise<IssueInvoiceResult | null | "error"> {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, status, channel_id, punto_venta")
    .eq("idempotency_key", idempotencyKey)
    .eq("created_by", userId)
    .maybeSingle();
  if (error) {
    logger.error("issue_invoice.idempotency_lookup_failed", {
      userId,
      error,
    });
    return "error";
  }
  if (!data || !isInvoiceStatus(data.status)) return null;
  // A draft may never have reached Inngest (the first submit died before or
  // during the send): send it again instead of returning a draft no run emits.
  if (data.status === "draft") {
    await enqueueIssue(userId, {
      invoice_id: data.id,
      idempotency_key: idempotencyKey,
      channel_id: data.channel_id,
      punto_venta: data.punto_venta,
    });
  }
  return { id: data.id, idempotency_key: idempotencyKey, status: data.status };
}

/** The fiscal identity a proposal showed (letter and receptor of the
 *  client then); the comprobante is refused if the client's changed. */
export type ExpectedReceptor = Pick<
  z.output<typeof CreateComprobanteSchema>,
  "letter" | "doc_tipo" | "doc_nro" | "iva_condition_receptor"
>;

/**
 * Issues a comprobante (factura, NC or ND; fiscal through AFIP, internal as a
 * remito interno): validates channel, client, punto de venta, origin and AFIP
 * rules, inserts the draft and its items in one transaction, queues the
 * issue-invoice run and audits `invoice.issue_requested`. A repeated `idempotency_key` returns the
 * draft the first call created.
 *
 * The caller has already checked `invoices:issue` (plus
 * `credit_debit_notes:issue` for an NC/ND) and parsed the input with
 * `CreateComprobanteSchema`: issueFiscalInvoiceAction (the form and every
 * feature that bills through it) and an accepted assistant proposal, which
 * passes `expected` so a client whose IVA condition or CUIT changed since
 * the card is not billed on stale data.
 */
export async function issueComprobante(
  actorId: string,
  data: z.output<typeof CreateComprobanteSchema>,
  expected?: ExpectedReceptor,
): Promise<ActionResult<IssueInvoiceResult>> {
  const supabase = getServiceClient();

  // A repeated submit of the same form (double click, retry after a lost
  // response) gets the draft the first one created.
  if (data.idempotency_key) {
    const existing = await findIssuedByKey(
      supabase,
      data.idempotency_key,
      actorId,
    );
    if (existing === "error") {
      return { ok: false, error: "No se pudo crear el comprobante." };
    }
    if (existing) return { ok: true, data: existing };
  }

  const [channel, client] = await Promise.all([
    loadChannel(supabase, data.channel_id),
    loadClient(supabase, data.client_id),
  ]);
  if (channel === "error" || client === "error") {
    return { ok: false, error: "No se pudo crear el comprobante." };
  }
  if (!channel) return { ok: false, error: "Canal no existe." };
  if (!channel.is_active)
    return { ok: false, error: "El canal está inactivo." };
  if (!client) return { ok: false, error: "Cliente no existe." };
  if (!client.is_active)
    return { ok: false, error: "El cliente está inactivo." };
  // guard_document_side refuses it too; said here in the user's words.
  if (client.is_fiscal !== channel.is_fiscal) {
    return {
      ok: false,
      error: channel.is_fiscal
        ? "Un comprobante de Ventas necesita un cliente de Ventas."
        : "Un comprobante de Otras ventas necesita un cliente de Otras ventas.",
    };
  }
  if (expected) {
    const now = voucherReceptor(client);
    const nowLetter =
      channel.is_fiscal && client.iva_condition
        ? letterFor(client.iva_condition)
        : null;
    if (
      now.doc_tipo !== expected.doc_tipo ||
      now.doc_nro !== expected.doc_nro ||
      now.iva_condition_receptor !== expected.iva_condition_receptor ||
      nowLetter !== expected.letter
    ) {
      return {
        ok: false,
        error:
          "El CUIT o la condición de IVA del cliente cambiaron desde la propuesta. Volvé a generarla.",
      };
    }
  }

  const pos = await loadEnabledPos(supabase, data.punto_venta, data.channel_id);
  if (pos === "error") {
    return { ok: false, error: "No se pudo crear el comprobante." };
  }
  if (!pos) {
    return {
      ok: false,
      error: `Punto de venta ${data.punto_venta} no está configurado o no pertenece a ${data.channel_id}.`,
    };
  }

  // NC/ND origin must be a real, emitted invoice of the same client and channel
  // with a number already assigned. Otherwise: NC against another client's
  // invoice (aging corruption), or CbtesAsoc with Nro=null (AFIP rejection).
  let origin: {
    letter: InvoiceLetter | null;
    moneda: string;
    cotizacion: number;
    receptor: CondicionIvaReceptorCode | null;
  } | null = null;
  if (data.invoice_origin_id) {
    const { data: originRow, error: originErr } = await supabase
      .from("invoices")
      .select(
        "id, client_id, channel_id, status, numero, kind, letter, moneda, cotizacion, iva_condition_receptor",
      )
      .eq("id", data.invoice_origin_id)
      .maybeSingle();
    if (originErr) {
      logger.error("issue_invoice.load_origin_failed", {
        userId: actorId,
        invoice_origin_id: data.invoice_origin_id,
        error: originErr,
      });
      return { ok: false, error: "No se pudo leer el comprobante de origen." };
    }
    if (!originRow) {
      return { ok: false, error: "El comprobante de origen no existe." };
    }
    if (originRow.status !== "emitted") {
      return { ok: false, error: "El comprobante de origen no está emitido." };
    }
    if (originRow.client_id !== data.client_id) {
      return {
        ok: false,
        error: "El comprobante de origen pertenece a otro cliente.",
      };
    }
    if (originRow.channel_id !== data.channel_id) {
      return {
        ok: false,
        error: "El comprobante de origen pertenece a otro canal.",
      };
    }
    if (originRow.numero === null) {
      return {
        ok: false,
        error: "El comprobante de origen todavía no tiene número.",
      };
    }
    if (data.kind === "nc" && originRow.kind === "nc") {
      return {
        ok: false,
        error:
          "Una nota de crédito no se puede emitir sobre otra nota de crédito.",
      };
    }
    origin = {
      letter: isInvoiceLetter(originRow.letter) ? originRow.letter : null,
      moneda: originRow.moneda,
      cotizacion: Number(originRow.cotizacion),
      receptor: isCondicionIvaReceptorCode(originRow.iva_condition_receptor)
        ? originRow.iva_condition_receptor
        : null,
    };
  }

  // An NC/ND is in its origin's currency. A foreign-currency note takes the
  // caller's cotización of the day when given, else the origin's.
  const moneda = origin?.moneda ?? data.moneda;
  const cotizacion =
    origin === null
      ? data.cotizacion
      : moneda === MONEDA.PESOS
        ? 1
        : data.moneda === moneda && data.cotizacion > 1
          ? data.cotizacion
          : origin.cotizacion;

  // Fiscal-only resolution. For internal channels we don't pick a letter or
  // a cbte_tipo_afip — the issue-invoice workflow takes the internal branch
  // (skips AFIP entirely, numbers locally, writes a "no fiscal" PDF). An NC/ND
  // carries its origin's letter and receptor condition (the client's
  // condition may have changed since); a factura's letter follows the receptor.
  let letter: InvoiceLetter | null = null;
  let cbteTipoAfip: CbteTipoCode | null = null;
  let receptor: CondicionIvaReceptorCode | null = null;
  if (channel.is_fiscal) {
    // A Ventas client always has one (clients_side_identity).
    const fiscalIva = client.iva_condition;
    if (!fiscalIva) {
      return { ok: false, error: "Falta la condición de IVA del cliente." };
    }
    const fiscalLetter: InvoiceLetter =
      origin?.letter ?? data.letter ?? letterFor(fiscalIva);
    const fiscalReceptor = origin?.receptor ?? data.iva_condition_receptor;
    if (fiscalReceptor === null) {
      return {
        ok: false,
        error:
          "Falta la condición de IVA del cliente para emitir el comprobante.",
      };
    }
    // Every fiscal line needs an IVA rate: a null rate lands its net in ImpNeto
    // but in no AlicIva bucket, so AFIP rejects the mismatch (ImpNeto != Σ BaseImp).
    if (data.items.some((it) => it.iva_rate_id === null)) {
      return {
        ok: false,
        error:
          "En comprobantes fiscales, cada ítem debe tener una alícuota de IVA.",
      };
    }
    const issue = fiscalVoucherIssue(
      {
        kind: data.kind,
        letter: fiscalLetter,
        receptor: fiscalReceptor,
        docTipo: data.doc_tipo,
        docNro: data.doc_nro,
        concepto: data.concepto,
        fecha: data.fecha,
        fchServDesde: data.fch_serv_desde ?? null,
        fchServHasta: data.fch_serv_hasta ?? null,
        fchVtoPago: data.fch_vto_pago ?? null,
        moneda,
        cotizacion,
        origin,
      },
      todayInAR(),
    );
    if (issue) return { ok: false, error: issue };

    // AFIP refuses a CbteFch earlier than the last voucher of the same type on
    // this punto de venta.
    const { data: last, error: lastErr } = await supabase
      .from("invoices")
      .select("fecha")
      .eq("channel_id", data.channel_id)
      .eq("punto_venta", data.punto_venta)
      .eq("kind", data.kind)
      .eq("letter", fiscalLetter)
      .not("numero", "is", null)
      // Walks invoices_channel_fecha_idx (channel_id, fecha desc).
      .order("fecha", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastErr) {
      logger.error("issue_invoice.load_last_fecha_failed", {
        userId: actorId,
        channel_id: data.channel_id,
        error: lastErr,
      });
      return {
        ok: false,
        error: "No se pudo validar la fecha del comprobante.",
      };
    }
    if (last && data.fecha < last.fecha) {
      return {
        ok: false,
        error: `La fecha no puede ser anterior a la del último comprobante de este tipo en el punto de venta (${last.fecha}).`,
      };
    }

    letter = fiscalLetter;
    cbteTipoAfip = cbteTipoFor(data.kind, fiscalLetter);
    receptor = fiscalReceptor;
  }

  // isFiscal drives IVA computation: internal channels must not accrue IVA
  // (it would post phantom revenue and charge IVA on a non-fiscal document).
  const totals = computeTotals(data.items, channel.is_fiscal);

  // An NC can't credit more than its origin owes by itself
  // (invoice_own_open_amount, the figure of the deferred guard, NCs in flight
  // included); credit spilled from other NCs does not count.
  if (data.kind === "nc" && data.invoice_origin_id) {
    const { data: open, error: openErr } = await supabase.rpc(
      "invoice_own_open_amount",
      { p_invoice_id: data.invoice_origin_id },
    );
    if (openErr) {
      logger.error("issue_invoice.load_origin_open_failed", {
        userId: actorId,
        invoice_origin_id: data.invoice_origin_id,
        error: openErr,
      });
      return {
        ok: false,
        error: "No se pudo leer el saldo del comprobante de origen.",
      };
    }
    const originOpen = Number(open ?? 0);
    if (totals.imp_total > originOpen + 0.01) {
      return {
        ok: false,
        error: `La nota de crédito (${formatMoney(totals.imp_total, paymentCurrencyOf(moneda))}) supera lo que el comprobante de origen debe por sí solo (${formatMoney(originOpen, paymentCurrencyOf(moneda))}).`,
      };
    }
  }

  const idempotency_key = data.idempotency_key ?? randomUUID();

  // The draft and its items in one transaction (create_invoice_draft): a
  // refused item leaves no header-only draft. The DB trigger validates the
  // fiscal-fields constraint (letter + cbte_tipo_afip required when
  // channel.is_fiscal), the unique index a non-duplicate idempotency_key.
  const draft: ComprobanteDraft = {
    channel_id: data.channel_id,
    client_id: data.client_id,
    kind: data.kind,
    letter,
    cbte_tipo_afip: cbteTipoAfip,
    punto_venta: data.punto_venta,
    numero: null, // reserved by the workflow (AFIP for fiscal, local for internal)
    fecha: data.fecha,
    fch_serv_desde: data.fch_serv_desde ?? null,
    fch_serv_hasta: data.fch_serv_hasta ?? null,
    fch_vto_pago: data.fch_vto_pago ?? null,
    concepto: data.concepto,
    doc_tipo: data.doc_tipo,
    doc_nro: data.doc_nro,
    iva_condition_receptor: receptor,
    imp_neto: totals.imp_neto,
    imp_iva: totals.imp_iva,
    imp_trib: 0,
    imp_tot_conc: 0,
    imp_op_ex: 0,
    imp_total: totals.imp_total,
    moneda,
    cotizacion,
    status: "draft",
    invoice_origin_id: data.invoice_origin_id ?? null,
    source_remito_id: data.source_remito_id ?? null,
    motivo_nc_nd: data.motivo_nc_nd ?? null,
    // Trimmed by the schema; a blank note is no note.
    notes: data.notes || null,
    // Left out, create_invoice_draft takes Jouve's (an NC/ND, its origin's).
    ...(data.is_operational !== undefined
      ? { is_operational: data.is_operational }
      : {}),
    idempotency_key,
    created_by: actorId,
  };
  const itemRows: ComprobanteItemDraft[] = data.items.map((item, index) => ({
    sort_order: index,
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unit_price,
    iva_rate_id: item.iva_rate_id,
    revenue_kind: item.revenue_kind ?? "service",
    ...computeLineAmounts(item, channel.is_fiscal),
  }));

  const inserted = await supabase.rpc("create_invoice_draft", {
    p_invoice: draft,
    p_items: itemRows,
  });
  // Two concurrent submits with one key: the second loses the unique index.
  if (inserted.error?.code === PG_UNIQUE_VIOLATION && data.idempotency_key) {
    const existing = await findIssuedByKey(
      supabase,
      data.idempotency_key,
      actorId,
    );
    if (existing && existing !== "error") return { ok: true, data: existing };
  }
  const guardError = mapDbGuardError(inserted.error, {
    slug: "issue_invoice.insert_draft.rejected",
    userId: actorId,
  });
  if (guardError) return { ok: false, error: guardError };
  if (inserted.error || !inserted.data) {
    logger.warn("issue_invoice.insert_draft_failed", {
      userId: actorId,
      channel_id: data.channel_id,
      client_id: data.client_id,
      err: inserted.error?.message,
    });
    return { ok: false, error: "No se pudo crear el comprobante." };
  }
  const invoice_id = inserted.data;

  // A failed send is not rolled back: Inngest may have accepted the event, and
  // deleting the draft would leave its CAE without a row. The draft stays and
  // is still returned, so the caller links it instead of billing again; a
  // resubmit with the same key, or issue-invoice-reconcile, sends it again.
  await enqueueIssue(actorId, {
    invoice_id,
    idempotency_key,
    channel_id: data.channel_id,
    punto_venta: data.punto_venta,
  });

  await logAudit(
    "invoice.issue_requested",
    actorId,
    {
      channel_id: data.channel_id,
      client_id: data.client_id,
      kind: data.kind,
      imp_total: totals.imp_total,
    },
    invoice_id,
  );

  return {
    ok: true,
    data: {
      id: invoice_id,
      idempotency_key,
      status: "draft",
    },
  };
}
