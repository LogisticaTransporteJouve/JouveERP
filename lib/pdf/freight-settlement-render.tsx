import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";

import {
  formatRemitoR,
  formatSettlementNumber,
} from "@/features/freight-settlements/schema";
import {
  formatInvoiceNumero,
  invoiceKindLabel,
  isInvoiceKind,
} from "@/features/invoices/schema";
import { formatArDateShort, formatArgentineDate } from "@/lib/format";
import { loadEmisor, redactEmisor } from "@/lib/pdf/emisor";
import { voucherEmisor, voucherParty } from "@/lib/pdf/voucher-data";
import { getServiceClient } from "@/lib/supabase/service";

import {
  FreightSettlementDocument,
  type FreightSettlementTemplateData,
} from "./freight-settlement-template";

export async function renderFreightSettlementPdf(
  data: FreightSettlementTemplateData,
): Promise<Buffer> {
  return renderToBuffer(<FreightSettlementDocument data={data} />);
}

function route(origin: string | null, destination: string | null): string {
  if (!origin && !destination) return "—";
  return `${origin ?? "—"} → ${destination ?? "—"}`;
}

/** The R document of a confirmed (or later) fiscal liquidación: its Remito
 *  R, or the legacy R-… of one confirmed before it. A draft has none, and an
 *  internal one prints as its remito interno X (/api/invoices/[id]/pdf). */
export async function buildFreightSettlementTemplateData(
  settlementId: string,
): Promise<FreightSettlementTemplateData> {
  const supabase = getServiceClient();

  const { data: s, error } = await supabase
    .from("freight_settlements")
    .select(
      "id, numero, remito_pos, remito_number, status, period_start, period_end, total, notes, confirmed_at, invoice_id, client:clients(legal_name, cuit, iva_condition, is_fiscal), invoice:invoices(kind, letter, punto_venta, numero, status, channel:invoicing_channels(is_fiscal, business_unit_id))",
    )
    .eq("id", settlementId)
    .maybeSingle();
  if (error || !s) {
    throw new Error(`freight-settlement-pdf: not found (${settlementId})`);
  }
  // A fiscal liquidación prints as its Remito R; one confirmed before the
  // remito R keeps its R-00000012 document.
  const remito =
    s.remito_pos !== null && s.remito_number !== null
      ? formatRemitoR(s.remito_pos, s.remito_number)
      : null;
  if (remito === null && s.numero === null) {
    throw new Error(
      s.status === "draft"
        ? "La liquidación es un borrador: confirmala para ver el R."
        : "La liquidación de Otras ventas no tiene R: su documento es el remito interno.",
    );
  }
  if (!s.client) throw new Error("freight-settlement-pdf: client missing");

  // The issuer of the client's side: the invoice's channel, else the first
  // active channel of that side (one business unit either way).
  let businessUnitId = s.invoice?.channel?.business_unit_id ?? null;
  if (!businessUnitId) {
    const { data: channel, error: chErr } = await supabase
      .from("invoicing_channels")
      .select("business_unit_id")
      .eq("is_fiscal", s.client.is_fiscal)
      .eq("is_active", true)
      .order("id")
      .limit(1)
      .maybeSingle();
    if (chErr) throw new Error(`freight-settlement-pdf: ${chErr.message}`);
    businessUnitId = channel?.business_unit_id ?? null;
  }
  const emisor = redactEmisor({
    isFiscal: s.client.is_fiscal,
    emisor: await loadEmisor(supabase, { business_unit_id: businessUnitId }),
  });

  const { data: items, error: itemsErr } = await supabase
    .from("freight_settlement_items")
    .select(
      "amount, shipment:shipments(remito_number, delivery_date, scheduled_date, origin, destination, description)",
    )
    .eq("settlement_id", settlementId)
    .order("created_at")
    .order("id");
  if (itemsErr) throw new Error("freight-settlement-pdf: failed to load items");

  const inv = s.invoice;
  const invoiceLabel =
    inv && inv.status !== "cancelled" && inv.status !== "failed"
      ? `${isInvoiceKind(inv.kind) ? invoiceKindLabel(inv.kind, inv.channel?.is_fiscal ?? true) : inv.kind} ${formatInvoiceNumero(inv.kind, inv.letter, inv.punto_venta, inv.numero, { whenNullNumero: "(en emisión)" })}`
          .trim()
          .replace(/\s+/g, " ")
      : null;

  return {
    emisor: voucherEmisor(emisor),
    client: voucherParty(s.client),
    heading: remito ? "REMITO" : "LIQUIDACIÓN DE FLETES",
    number: remito ?? formatSettlementNumber(s.numero),
    fecha: formatArDateShort(s.confirmed_at),
    period: `${formatArgentineDate(s.period_start)} al ${formatArgentineDate(s.period_end)}`,
    items: (items ?? []).map((i) => {
      const date = i.shipment?.delivery_date ?? i.shipment?.scheduled_date;
      return {
        date: date ? formatArgentineDate(date) : "—",
        remito: i.shipment?.remito_number ?? "—",
        route: route(
          i.shipment?.origin ?? null,
          i.shipment?.destination ?? null,
        ),
        description: i.shipment?.description ?? "Flete",
        amount: Number(i.amount),
      };
    }),
    total: Number(s.total),
    plusIva: s.client.is_fiscal,
    invoiceLabel,
    notes: s.notes,
    cancelled: s.status === "cancelled",
  };
}
