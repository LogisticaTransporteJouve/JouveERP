import { foldNonComputable } from "@/lib/afip/codes";
import { formatMoney, round2 } from "@/lib/format";

import type {
  PURCHASE_TRIBUTE_FIELDS,
  PurchaseIvaRateId,
  ReceivedVoucher,
} from "../schema";
import type { PurchaseInvoiceDraftData } from "./purchase-invoice-draft";

type TributeField = (typeof PURCHASE_TRIBUTE_FIELDS)[number];

export type ReceivedAmounts = {
  imp_neto: number;
  imp_no_gravado: number;
  imp_op_exentas: number;
  imp_iva: number;
  imp_trib: number;
  imp_total: number;
};

/** The amounts a purchase from this voucher carries: letter A as ARCA lists
 *  them; on B and C, IVA, exento and no gravado go inside the net. Shared by
 *  the accept dialog and the action that checks what it sends. */
export function receivedVoucherAmounts(
  voucher: Pick<
    ReceivedVoucher,
    | "letter"
    | "imp_neto_gravado"
    | "imp_no_gravado"
    | "imp_op_exentas"
    | "imp_iva"
    | "imp_trib"
    | "imp_total"
  >,
): ReceivedAmounts {
  const parts = foldNonComputable(voucher.letter, {
    imp_neto: voucher.imp_neto_gravado,
    imp_no_gravado: voucher.imp_no_gravado,
    imp_op_exentas: voucher.imp_op_exentas,
    imp_iva: voucher.imp_iva,
  });
  return { ...parts, imp_trib: voucher.imp_trib, imp_total: voucher.imp_total };
}

/** ARCA's per-tribute columns, keyed as the purchase stores them. */
export function receivedTributeSplit(
  voucher: Pick<ReceivedVoucher, "trib_breakdown">,
): Partial<Record<TributeField, number>> {
  const b = voucher.trib_breakdown;
  const split: Partial<Record<TributeField, number>> = {};
  if (b.perc_iva !== undefined) split.imp_perc_iva = b.perc_iva;
  if (b.perc_iibb !== undefined) split.imp_perc_iibb = b.perc_iibb;
  if (b.municipales !== undefined) split.imp_perc_municipales = b.municipales;
  if (b.internos !== undefined) split.imp_impuestos_internos = b.internos;
  return split;
}

/** One line per alícuota for a letter A voucher whose export lists them and
 *  ties to the cent with its neto and IVA (the items would rewrite the
 *  header); empty otherwise, and the purchase is saved header-only. */
export function receivedVoucherItems(
  voucher: Pick<
    ReceivedVoucher,
    "letter" | "iva_breakdown" | "imp_neto_gravado" | "imp_iva"
  >,
): {
  description: string;
  quantity: number;
  unit_price: number;
  iva_rate_id: PurchaseIvaRateId;
  line_neto: number;
  line_iva: number;
  line_total: number;
  sort_order: number;
}[] {
  if (voucher.letter !== "A" || voucher.iva_breakdown.length === 0) return [];
  const sum = (pick: (l: ReceivedVoucher["iva_breakdown"][number]) => number) =>
    round2(voucher.iva_breakdown.reduce((a, l) => a + pick(l), 0));
  if (
    sum((l) => l.neto) !== round2(voucher.imp_neto_gravado) ||
    sum((l) => l.iva) !== round2(voucher.imp_iva)
  ) {
    return [];
  }
  return voucher.iva_breakdown.map((line, i) => ({
    description: "Según ARCA → Mis Comprobantes",
    quantity: 1,
    unit_price: line.neto,
    iva_rate_id: line.iva_rate_id,
    line_neto: line.neto,
    line_iva: line.iva,
    line_total: +(line.neto + line.iva).toFixed(2),
    sort_order: i,
  }));
}

/** The draft the accept dialog opens with. */
export function arcaVoucherToDraft(
  voucher: ReceivedVoucher,
): PurchaseInvoiceDraftData {
  const amounts = receivedVoucherAmounts(voucher);
  const tributes = receivedTributeSplit(voucher);
  const kind = voucher.kind ?? "factura";
  const warnings: string[] = [];
  if (kind !== "factura") warnings.push("NC/ND: elegí la factura de origen.");
  if (voucher.moneda === "DOL") warnings.push("USD: revisá la cotización.");
  if (amounts.imp_trib > 0 && Object.keys(tributes).length === 0) {
    warnings.push(
      `Repartí los otros tributos (${formatMoney(amounts.imp_trib)}) entre percepción IVA, IIBB, municipales e impuestos internos.`,
    );
  }
  return {
    supplier: voucher.supplier,
    unmatchedSupplier: voucher.supplier
      ? null
      : { legal_name: voucher.issuer_name, cuit: voucher.issuer_cuit },
    kind,
    kind_read: true,
    letter: voucher.letter,
    punto_venta: voucher.punto_venta,
    numero: voucher.numero,
    fecha: voucher.fecha,
    fch_vto_pago: null,
    cae_proveedor: voucher.cae,
    cae_vto_proveedor: null,
    imp_neto: amounts.imp_neto,
    imp_iva: amounts.imp_iva,
    imp_trib: amounts.imp_trib,
    imp_total: amounts.imp_total,
    imp_no_gravado: amounts.imp_no_gravado,
    imp_op_exentas: amounts.imp_op_exentas,
    tributes,
    moneda: voucher.moneda,
    cotizacion: voucher.moneda === "DOL" ? voucher.cotizacion : 1,
    motivo_nc_nd: kind === "factura" ? null : "Según ARCA → Mis Comprobantes",
    items: [],
    account: null,
    cost_center_id: null,
    warnings,
  };
}
