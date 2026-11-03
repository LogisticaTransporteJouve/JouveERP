"use server";

import { logAudit } from "@/lib/actions/audit";
import { CONCEPTO, IVA_RATE, MONEDA, voucherReceptor } from "@/lib/afip/codes";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { todayInAR } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import { isIvaCondition } from "@/features/clients/schema";
import { issueFiscalInvoiceAction } from "@/features/invoices/actions/invoices-actions";

import { invoiceIsVoid, releaseInvoicingClaim } from "../lib/invoicing-claim";
import {
  FreightCandidatesSchema,
  FreightSettlementIdSchema,
  FreightSettlementInvoiceSchema,
  FreightSettlementSaveSchema,
  freightItemDescription,
  formatSettlementNumber,
  isFreightPriceSource,
  isFreightSettlementStatus,
  type FreightCandidatesInput,
  type FreightSettlement,
  type FreightSettlementCandidate,
  type FreightSettlementDetail,
  type FreightSettlementInvoiceInput,
  type FreightSettlementItem,
  type FreightSettlementSaveInput,
} from "../schema";

const READ_DENIED = "No tenés permiso para ver liquidaciones.";
const WRITE_DENIED = "No tenés permiso para liquidar fletes.";

/** A claim older than this is an abandoned request (same window as the
 *  cancel_freight_settlement check). */
const CLAIM_TTL_MS = 15 * 60 * 1000;

const SETTLEMENT_COLUMNS =
  "id, numero, client_id, period_start, period_end, status, total, invoice_id, invoicing_claimed_at, notes, created_at, client:clients(legal_name, is_fiscal), invoice:invoices(status)";

type SettlementRow = {
  id: string;
  numero: number | null;
  client_id: string;
  period_start: string;
  period_end: string;
  status: string;
  total: number;
  invoice_id: string | null;
  invoicing_claimed_at: string | null;
  notes: string | null;
  created_at: string;
  client: { legal_name: string; is_fiscal: boolean } | null;
  invoice: { status: string } | null;
};

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

/** A status the app does not know is dropped and logged, not mislabelled. */
function narrowSettlement(row: SettlementRow): FreightSettlement | null {
  if (!isFreightSettlementStatus(row.status)) {
    logger.error("freight_settlements.unknown_status", {
      id: row.id,
      status: row.status,
    });
    return null;
  }
  const claimedAt = row.invoicing_claimed_at
    ? Date.parse(row.invoicing_claimed_at)
    : null;
  return {
    id: row.id,
    numero: row.numero,
    client_id: row.client_id,
    client_name: row.client?.legal_name ?? "—",
    client_is_fiscal: row.client?.is_fiscal ?? true,
    period_start: row.period_start,
    period_end: row.period_end,
    status: row.status,
    total: Number(row.total),
    invoice_id: row.invoice_id,
    invoice_status: row.invoice?.status ?? null,
    invoicing:
      row.invoice_id === null &&
      claimedAt !== null &&
      Date.now() - claimedAt < CLAIM_TTL_MS,
    notes: row.notes,
    created_at: row.created_at,
  };
}

/** Every liquidación, newest first. Gated on invoices:read (billing data). */
export async function listFreightSettlementsAction(): Promise<
  ActionResult<FreightSettlement[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "invoices:read")) {
    return { ok: false, error: READ_DENIED };
  }
  const supabase = getServiceClient();
  const res = await paginateRange<SettlementRow>((from, to) =>
    supabase
      .from("freight_settlements")
      .select(SETTLEMENT_COLUMNS)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to),
  );
  if (res.error) {
    logger.error("freight_settlements.list.failed", {
      userId: ctx.userId,
      error: res.error,
    });
    return { ok: false, error: "No se pudieron listar las liquidaciones." };
  }
  return {
    ok: true,
    data: res.data
      .map(narrowSettlement)
      .filter((s): s is FreightSettlement => s !== null),
  };
}

export async function getFreightSettlementAction(
  id: string,
): Promise<ActionResult<FreightSettlementDetail>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "invoices:read")) {
    return { ok: false, error: READ_DENIED };
  }
  const parsed = FreightSettlementIdSchema.safeParse({ id });
  if (!parsed.success) return { ok: false, error: "Liquidación inválida." };

  const supabase = getServiceClient();
  const [head, items] = await Promise.all([
    supabase
      .from("freight_settlements")
      .select(SETTLEMENT_COLUMNS)
      .eq("id", parsed.data.id)
      .maybeSingle(),
    // A cancelled liquidación lists the cargas it had (now released).
    supabase
      .from("freight_settlement_items")
      .select(
        "id, shipment_id, amount, price_source, shipment:shipments(remito_number, delivery_date, scheduled_date, origin, destination, description, channel_id)",
      )
      .eq("settlement_id", parsed.data.id)
      .order("created_at")
      .order("id"),
  ]);
  if (head.error || items.error) {
    logger.error("freight_settlements.detail.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error: head.error ?? items.error,
    });
    return { ok: false, error: "No se pudo cargar la liquidación." };
  }
  const settlement = head.data ? narrowSettlement(head.data) : null;
  if (!settlement)
    return { ok: false, error: "No se encontró la liquidación." };

  const rows: FreightSettlementItem[] = [];
  for (const i of items.data ?? []) {
    if (!isFreightPriceSource(i.price_source)) {
      logger.error("freight_settlements.unknown_price_source", { id: i.id });
      return { ok: false, error: "No se pudo cargar la liquidación." };
    }
    rows.push({
      id: i.id,
      shipment_id: i.shipment_id,
      remito_number: i.shipment?.remito_number ?? null,
      service_date:
        i.shipment?.delivery_date ?? i.shipment?.scheduled_date ?? null,
      origin: i.shipment?.origin ?? null,
      destination: i.shipment?.destination ?? null,
      description: i.shipment?.description ?? null,
      channel_id: i.shipment?.channel_id ?? null,
      amount: Number(i.amount),
      price_source: i.price_source,
    });
  }
  return { ok: true, data: { ...settlement, items: rows } };
}

/** The client's delivered cargas in the period a liquidación can take, each
 *  with its price (null = neither flete nor tariff). */
export async function listFreightSettlementCandidatesAction(
  input: FreightCandidatesInput,
): Promise<ActionResult<FreightSettlementCandidate[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "invoices:read")) {
    return { ok: false, error: READ_DENIED };
  }
  const parsed = FreightCandidatesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;

  const supabase = getServiceClient();
  const res = await paginateRange((from, to) =>
    supabase
      .rpc("freight_settlement_candidates", {
        p_client_id: d.client_id,
        p_period_start: d.period_start,
        p_period_end: d.period_end,
        ...(d.settlement_id ? { p_settlement_id: d.settlement_id } : {}),
      })
      .range(from, to),
  );
  if (res.error) {
    logger.error("freight_settlements.candidates.failed", {
      userId: ctx.userId,
      error: res.error,
    });
    return { ok: false, error: "No se pudieron cargar las cargas." };
  }
  return {
    ok: true,
    data: res.data.map((c) => ({
      shipment_id: c.shipment_id,
      remito_number: c.remito_number ?? null,
      service_date: c.service_date ?? null,
      origin: c.origin ?? null,
      destination: c.destination ?? null,
      description: c.description ?? null,
      amount: c.amount === null ? null : Number(c.amount),
      price_source: isFreightPriceSource(c.price_source)
        ? c.price_source
        : null,
    })),
  };
}

/** Creates a draft or replaces a draft's period, notes and cargas. */
export async function saveFreightSettlementAction(
  input: FreightSettlementSaveInput,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "invoices:issue")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = FreightSettlementSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;

  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("save_freight_settlement", {
    p_client_id: d.client_id,
    p_period_start: d.period_start,
    p_period_end: d.period_end,
    p_shipment_ids: d.shipment_ids,
    p_notes: d.notes ?? "",
    p_user_id: ctx.userId,
    ...(d.id ? { p_settlement_id: d.id } : {}),
  });
  if (error || !data) {
    const guardError = mapDbGuardError(error, {
      slug: "freight_settlements.save.rejected",
      userId: ctx.userId,
      id: d.id ?? null,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("freight_settlements.save.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo guardar la liquidación." };
  }

  await logAudit(
    d.id ? "freight_settlement.updated" : "freight_settlement.created",
    ctx.userId,
    {
      client_id: d.client_id,
      period_start: d.period_start,
      period_end: d.period_end,
      shipments: d.shipment_ids.length,
    },
    data,
  );
  return { ok: true, data: { id: data } };
}

/** Reprices the draft from its cargas' flete or tariff and gives it its R
 *  number. Confirming twice returns the same number. */
export async function confirmFreightSettlementAction(input: {
  id: string;
}): Promise<ActionResult<{ numero: number }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "invoices:issue")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = FreightSettlementIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Liquidación inválida." };

  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("confirm_freight_settlement", {
    p_settlement_id: parsed.data.id,
    p_user_id: ctx.userId,
  });
  if (error || data === null) {
    const guardError = mapDbGuardError(error, {
      slug: "freight_settlements.confirm.rejected",
      userId: ctx.userId,
      id: parsed.data.id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("freight_settlements.confirm.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error,
    });
    return { ok: false, error: "No se pudo confirmar la liquidación." };
  }

  await logAudit(
    "freight_settlement.confirmed",
    ctx.userId,
    { numero: formatSettlementNumber(data) },
    parsed.data.id,
  );
  return { ok: true, data: { numero: data } };
}

/** Cancels the liquidación and frees its cargas. An invoiced one needs its
 *  invoice void first (cancelled, or fully credited by an NC). */
export async function cancelFreightSettlementAction(input: {
  id: string;
}): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "invoices:issue")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = FreightSettlementIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Liquidación inválida." };

  const supabase = getServiceClient();
  const { error } = await supabase.rpc("cancel_freight_settlement", {
    p_settlement_id: parsed.data.id,
    p_user_id: ctx.userId,
  });
  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "freight_settlements.cancel.rejected",
      userId: ctx.userId,
      id: parsed.data.id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("freight_settlements.cancel.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error,
    });
    return { ok: false, error: "No se pudo cancelar la liquidación." };
  }

  await logAudit(
    "freight_settlement.cancelled",
    ctx.userId,
    {},
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}

/**
 * "Facturar": ONE invoice for every carga of a confirmed liquidación, one
 * line per carga at 21% IVA, through issueFiscalInvoiceAction (AFIP on a
 * fiscal channel, remito interno on an internal one). The liquidación is
 * claimed first, so two clicks cannot both issue; the invoice is linked on
 * success (link_freight_settlement_invoice) and the claim released on
 * failure. A failed or cancelled invoice puts the liquidación back to
 * confirmed (invoices_release_freight_settlement).
 */
export async function invoiceFreightSettlementAction(
  input: FreightSettlementInvoiceInput,
): Promise<ActionResult<{ invoiceId: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "invoices:issue")) {
    return { ok: false, error: "No tenés permiso para facturar." };
  }
  const parsed = FreightSettlementInvoiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { id, channel_id, punto_venta } = parsed.data;

  const supabase = getServiceClient();
  const detail = await getFreightSettlementAction(id);
  if (!detail.ok) return detail;
  const settlement = detail.data;
  if (settlement.status !== "confirmed" || settlement.invoice_id) {
    return {
      ok: false,
      error: "Solo se factura una liquidación confirmada y sin factura.",
    };
  }

  const clientRes = await supabase
    .from("clients")
    .select("cuit, iva_condition, is_fiscal")
    .eq("id", settlement.client_id)
    .maybeSingle();
  if (clientRes.error || !clientRes.data) {
    logger.error("freight_settlements.invoice.read_failed", {
      userId: ctx.userId,
      id,
      error: clientRes.error,
    });
    return { ok: false, error: "No se pudo leer el cliente." };
  }
  const client = clientRes.data;
  // An Otras ventas client has no CUIT: its liquidación goes on a remito
  // interno.
  if (client.is_fiscal && !client.cuit) {
    return { ok: false, error: "El cliente necesita un CUIT para facturar." };
  }
  const ivaCondition = isIvaCondition(client.iva_condition)
    ? client.iva_condition
    : null;
  if (client.is_fiscal && !ivaCondition) {
    return { ok: false, error: "La condición de IVA del cliente es inválida." };
  }
  // A carga booked on a channel is billed on that channel only.
  if (
    settlement.items.some(
      (i) => i.channel_id !== null && i.channel_id !== channel_id,
    )
  ) {
    return {
      ok: false,
      error:
        "Hay cargas cargadas en otro canal: facturá la liquidación en el canal de sus cargas.",
    };
  }

  const staleBefore = new Date(Date.now() - CLAIM_TTL_MS).toISOString();
  const claim = await supabase
    .from("freight_settlements")
    .update({ invoicing_claimed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "confirmed")
    .is("invoice_id", null)
    .or(`invoicing_claimed_at.is.null,invoicing_claimed_at.lt.${staleBefore}`)
    .select("id");
  if (claim.error) {
    logger.error("freight_settlements.invoice.claim_failed", {
      userId: ctx.userId,
      id,
      error: claim.error,
    });
    return { ok: false, error: "No se pudo reservar la liquidación." };
  }
  if (claim.data.length === 0) {
    return {
      ok: false,
      error: "La liquidación ya se facturó o se está facturando.",
    };
  }

  const today = todayInAR();
  const result = await issueFiscalInvoiceAction({
    channel_id,
    client_id: settlement.client_id,
    kind: "factura",
    letter: null,
    punto_venta,
    fecha: today,
    fch_serv_desde: settlement.period_start,
    fch_serv_hasta: settlement.period_end,
    fch_vto_pago: settlement.period_end > today ? settlement.period_end : today,
    concepto: CONCEPTO.SERVICIOS,
    ...voucherReceptor({ cuit: client.cuit, iva_condition: ivaCondition }),
    moneda: MONEDA.PESOS,
    cotizacion: 1,
    items: settlement.items.map((item) => ({
      description: freightItemDescription(item),
      quantity: 1,
      unit_price: item.amount,
      iva_rate_id: IVA_RATE.TWENTY_ONE,
    })),
  });
  if (!result.ok) {
    await releaseInvoicingClaim(supabase, id, ctx.userId);
    return result;
  }

  const { error: linkErr } = await supabase.rpc(
    "link_freight_settlement_invoice",
    { p_settlement_id: id, p_invoice_id: result.data.id },
  );
  if (linkErr) {
    logger.error("freight_settlements.invoice.link_failed", {
      userId: ctx.userId,
      id,
      invoiceId: result.data.id,
      error: linkErr,
    });
    // The invoice already failed or was cancelled (the link guard refuses
    // it): nothing holds the liquidación, so free it now instead of after
    // the claim's TTL. Any other error keeps it claimed.
    if (await invoiceIsVoid(supabase, result.data.id)) {
      await releaseInvoicingClaim(supabase, id, ctx.userId);
    }
    return {
      ok: false,
      error:
        mapDbGuardError(linkErr, {
          slug: "freight_settlements.invoice.link_rejected",
          userId: ctx.userId,
          id,
        }) ??
        "La factura se emitió pero no se vinculó a la liquidación. Anotá el comprobante antes de volver a facturar.",
    };
  }

  await logAudit(
    "freight_settlement.invoiced",
    ctx.userId,
    {
      invoice_id: result.data.id,
      numero: formatSettlementNumber(settlement.numero),
      total: settlement.total,
    },
    id,
  );
  return { ok: true, data: { invoiceId: result.data.id } };
}
