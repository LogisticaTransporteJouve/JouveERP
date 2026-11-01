import "server-only";

// M.0 — Builds InvoiceTemplateData (joining comprobante + items + client +
// channel + business_unit). PDF rendering and hash persistence
// live in generate-and-hash.ts. This file no longer uploads to Storage
// — PDFs are regenerated on-demand in /api/invoices/[id]/pdf.

import {
  buildInvoiceQRUrl,
  renderInvoiceQR,
  type InvoiceQRPayload,
} from "@/lib/afip/qr";
import { round2 } from "@/lib/format";
import { getServiceClient } from "@/lib/supabase/service";

import type {
  InvoiceTemplateData,
  InvoiceTemplateItem,
} from "./invoice-template";

import type { InvoiceKind, InvoiceLetter } from "@/lib/afip/codes";
import { loadEmisor, redactEmisor } from "@/lib/pdf/emisor";
import type { IvaCondition } from "@/features/clients/schema";
import type { InvoiceRow } from "@/features/invoices/schema";

const DOC_TIPO_LABEL: Record<number, string> = {
  80: "CUIT",
  86: "CUIL",
  96: "DNI",
  99: "Consumidor Final",
};

const IVA_LABEL: Record<IvaCondition, string> = {
  responsable_inscripto: "Responsable Inscripto",
  monotributo: "Monotributo",
  exento: "Exento",
  consumidor_final: "Consumidor Final",
  no_categorizado: "No Categorizado",
};

export async function buildTemplateData(
  comprobanteId: string,
): Promise<InvoiceTemplateData> {
  const supabase = getServiceClient();
  const { data: row, error } = await supabase
    .from("invoices")
    .select(
      `
      *,
      channel:invoicing_channels(id, name, is_fiscal, business_unit_id),
      client:clients(id, legal_name, iva_condition, address, real_address),
      items:invoice_items(description, quantity, unit_price, iva_rate_id, line_neto, line_iva, line_total, sort_order)
    `,
    )
    .eq("id", comprobanteId)
    .maybeSingle();
  if (error) throw new Error(`load-comprobante: ${error.message}`);
  if (!row) throw new Error(`Invoice ${comprobanteId} does not exist.`);

  const channel = row.channel as {
    id: string;
    name: string;
    is_fiscal: boolean;
    business_unit_id: string;
  } | null;
  const client = row.client as {
    id: string;
    legal_name: string;
    iva_condition: IvaCondition | null;
    address: string | null;
    real_address: string | null;
  } | null;
  const items = (row.items ?? []) as Array<{
    description: string;
    quantity: number | string;
    unit_price: number | string;
    iva_rate_id: number | null;
    line_neto: number | string;
    line_iva: number | string;
    line_total: number | string;
    sort_order: number;
  }>;
  if (!channel) throw new Error("Comprobante missing channel relation.");
  if (!client) throw new Error("Comprobante missing client relation.");

  if (row.numero == null) {
    throw new Error(
      "Comprobante sin número asignado — esperá a que reserve-numero termine.",
    );
  }
  const numero: number = row.numero;

  const isFiscal = channel.is_fiscal;
  const emisor = await loadEmisor(supabase, channel);

  const sortedItems: InvoiceTemplateItem[] = items
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((it) => ({
      description: it.description,
      quantity: Number(it.quantity),
      unit_price: Number(it.unit_price),
      iva_rate_id:
        it.iva_rate_id === null
          ? null
          : (it.iva_rate_id as InvoiceTemplateItem["iva_rate_id"]),
      line_neto: Number(it.line_neto),
      line_total: Number(it.line_total),
    }));

  // Aggregate IVA per rate from items.
  const buckets = new Map<number, { base: number; importe: number }>();
  for (const it of items) {
    if (it.iva_rate_id === null) continue;
    const bucket = buckets.get(it.iva_rate_id) ?? { base: 0, importe: 0 };
    bucket.base = round2(bucket.base + Number(it.line_neto));
    bucket.importe = round2(bucket.importe + Number(it.line_iva));
    buckets.set(it.iva_rate_id, bucket);
  }
  const per_rate: InvoiceTemplateData["per_rate"] = [];
  for (const [id, b] of buckets) {
    per_rate.push({
      id: id as InvoiceTemplateData["per_rate"][number]["id"],
      base: b.base,
      importe: b.importe,
    });
  }
  per_rate.sort((a, b) => a.id - b.id);

  // QR (only fiscal + has CAE)
  let qrDataUrl: string | null = null;
  if (isFiscal && row.cae && row.cbte_tipo_afip !== null) {
    const qrPayload: InvoiceQRPayload = {
      fecha: row.fecha,
      cuit: emisor.cuit,
      ptoVta: row.punto_venta,
      tipoCmp: row.cbte_tipo_afip,
      nroCmp: numero,
      importe: Number(row.imp_total),
      moneda: row.moneda,
      ctz: Number(row.cotizacion),
      tipoDocRec: row.doc_tipo,
      nroDocRec: row.doc_nro === "" ? 0 : Number(row.doc_nro),
      tipoCodAut: row.emission_type === "caea" ? "A" : "E",
      codAut: row.cae,
    };
    // Validate URL parses without crashing — buildInvoiceQRUrl is total but
    // calling it surfaces config errors before we hit the renderer.
    buildInvoiceQRUrl(qrPayload);
    qrDataUrl = await renderInvoiceQR(qrPayload);
  }

  return {
    isFiscal,
    emittedAt: row.emitted_at ?? `${row.fecha}T00:00:00-03:00`,
    // D5: an internal comprobante prints no fiscal data of the issuer.
    emisor: redactEmisor({ isFiscal, emisor }),
    receptor: {
      legal_name: client.legal_name,
      doc_tipo_label: DOC_TIPO_LABEL[row.doc_tipo] ?? String(row.doc_tipo),
      doc_nro: row.doc_nro,
      // An Otras ventas client has no IVA condition (nor CUIT).
      iva_condition_label: client.iva_condition
        ? IVA_LABEL[client.iva_condition]
        : null,
      condicion_iva_receptor: row.iva_condition_receptor,
      address: client.real_address ?? client.address,
    },
    kind: row.kind as InvoiceKind,
    letter: (row.letter as InvoiceLetter | null) ?? null,
    punto_venta: row.punto_venta,
    numero,
    fecha: row.fecha,
    fch_serv_desde: row.fch_serv_desde,
    fch_serv_hasta: row.fch_serv_hasta,
    fch_vto_pago: row.fch_vto_pago,
    concepto_label:
      row.concepto === 1
        ? "Productos"
        : row.concepto === 2
          ? "Servicios"
          : "Productos y Servicios",
    items: sortedItems,
    imp_neto: Number(row.imp_neto),
    imp_iva: Number(row.imp_iva),
    imp_trib: Number(row.imp_trib),
    imp_tot_conc: Number(row.imp_tot_conc),
    imp_op_ex: Number(row.imp_op_ex),
    imp_total: Number(row.imp_total),
    per_rate,
    moneda: row.moneda,
    cotizacion: Number(row.cotizacion),
    cae: row.cae,
    cae_vencimiento: row.cae_vencimiento,
    qr_data_url: qrDataUrl,
  };
}

// Re-export so the Inngest workflow can import without pulling in the heavy
// renderer transitively at module load time.
export type { InvoiceRow };
