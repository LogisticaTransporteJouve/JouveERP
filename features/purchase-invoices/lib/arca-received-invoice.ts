import type { z } from "zod";

import { round2 } from "@/lib/format";

import {
  PURCHASE_TRIBUTE_FIELDS,
  type ArcaGapTarget,
  type PurchaseInvoiceCreateSchema,
  type PurchaseInvoiceKind,
  type ReceivedVoucher,
} from "../schema";
import { placeReceivedGap, type ReceivedAmounts } from "./arca-received-draft";
import type { PurchaseInvoiceDraftData } from "./purchase-invoice-draft";

// The purchase an ARCA received voucher loads as, built from the tray's own
// draft (arcaVoucherToDraft). Shared by the assistant's proposal and the
// bulk accept, which both send it to acceptReceivedVoucher.

export type TributeField = (typeof PURCHASE_TRIBUTE_FIELDS)[number];
export type TributeSplit = Record<TributeField, number>;

export const ARCA_NOTE_MOTIVO = "Según ARCA → Mis Comprobantes";

export function fullTributeSplit(partial: Partial<TributeSplit>): TributeSplit {
  return {
    imp_perc_iva: partial.imp_perc_iva ?? 0,
    imp_perc_nacionales: partial.imp_perc_nacionales ?? 0,
    imp_perc_iibb: partial.imp_perc_iibb ?? 0,
    imp_perc_municipales: partial.imp_perc_municipales ?? 0,
    imp_impuestos_internos: partial.imp_impuestos_internos ?? 0,
  };
}

export const tributeSplitTotal = (s: TributeSplit) =>
  round2(PURCHASE_TRIBUTE_FIELDS.reduce((a, f) => a + s[f], 0));

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The due date the form prefills: the supplier's payment term from the
 *  date, when it has one. */
export function supplierDueDate(
  supplier: { default_payment_term_days: number | null },
  fecha: string,
): string | null {
  return supplier.default_payment_term_days != null
    ? addDays(fecha, supplier.default_payment_term_days)
    : null;
}

/** ARCA's amounts as the tray's draft reads them, with the gap (when there
 *  is one and it was placed) where it goes. */
export function arcaDraftAmounts(
  base: Pick<
    PurchaseInvoiceDraftData,
    | "imp_neto"
    | "imp_no_gravado"
    | "imp_op_exentas"
    | "imp_iva"
    | "imp_trib"
    | "imp_total"
    | "arca_gap"
  >,
  letter: string | null,
  gapTarget: ArcaGapTarget | null,
): ReceivedAmounts {
  const arca = {
    imp_neto: base.imp_neto ?? 0,
    imp_no_gravado: base.imp_no_gravado ?? 0,
    imp_op_exentas: base.imp_op_exentas ?? 0,
    imp_iva: base.imp_iva ?? 0,
    imp_trib: base.imp_trib ?? 0,
    imp_total: base.imp_total ?? 0,
  };
  const gap = base.arca_gap ?? null;
  return gap !== null && gapTarget !== null
    ? placeReceivedGap(arca, letter, gap, gapTarget)
    : arca;
}

export type ArcaReceivedInvoiceInput = z.input<
  typeof PurchaseInvoiceCreateSchema
>;

/** The purchase sent to acceptReceivedVoucher: number, date, currency, CAE
 *  and amounts are ARCA's; the rest is what the caller resolved. */
export function arcaReceivedInvoice(
  voucher: Pick<
    ReceivedVoucher,
    "letter" | "punto_venta" | "numero" | "fecha" | "moneda" | "cae"
  > & { kind: PurchaseInvoiceKind },
  p: {
    channelId: string;
    supplierId: string;
    accountId: string | null;
    costCenterId: string | null;
    amounts: ReceivedAmounts;
    split: TributeSplit;
    cotizacion: number;
    fchVtoPago: string;
    originId: string | null;
    notes: string | null;
  },
): ArcaReceivedInvoiceInput {
  return {
    channel_id: p.channelId,
    account_id: p.accountId,
    cost_center_id: p.costCenterId,
    supplier_id: p.supplierId,
    kind: voucher.kind,
    letter: voucher.letter,
    punto_venta: voucher.punto_venta,
    numero: voucher.numero,
    fecha: voucher.fecha,
    fch_vto_pago: p.fchVtoPago,
    ...p.amounts,
    ...p.split,
    moneda: voucher.moneda,
    cotizacion: p.cotizacion,
    cae_proveedor: voucher.cae,
    cae_vto_proveedor: null,
    invoice_origin_id: p.originId,
    motivo_nc_nd: voucher.kind === "factura" ? null : ARCA_NOTE_MOTIVO,
    notes: p.notes,
    items: [],
  };
}
