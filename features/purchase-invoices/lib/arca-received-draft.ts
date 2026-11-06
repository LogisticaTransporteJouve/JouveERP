import {
  foldNonComputable,
  IVA_RATE,
  IVA_RATE_PERCENT,
  ivaIsComputable,
} from "@/lib/afip/codes";
import { formatMoney, round2 } from "@/lib/format";
import {
  suggestTributeSplit,
  TRIBUTE_SUGGESTION_NOTE,
} from "@/lib/purchases/tribute-split";

import {
  RAW_AMOUNT_LABEL,
  type ArcaGapTarget,
  type PURCHASE_TRIBUTE_FIELDS,
  type PurchaseIvaRateId,
  type RawAmountKey,
  type ReceivedVoucher,
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

/** The gap ARCA's rounding may leave between a voucher's parts and total. */
const ROUNDING_CENT = 0.01;

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
  // A purchase's parts add up to its total to the cent; ARCA's own rounding
  // can leave one. It goes where it changes no tax: no gravado on an A (the
  // net when that would go negative), the net on a B or C (all net there).
  const gap = round2(
    voucher.imp_total -
      (parts.imp_neto +
        parts.imp_no_gravado +
        parts.imp_op_exentas +
        parts.imp_iva +
        voucher.imp_trib),
  );
  if (gap !== 0 && Math.abs(gap) <= ROUNDING_CENT) {
    if (voucher.letter === "A" && parts.imp_no_gravado + gap >= 0) {
      parts.imp_no_gravado = round2(parts.imp_no_gravado + gap);
    } else {
      parts.imp_neto = round2(parts.imp_neto + gap);
    }
  }
  return { ...parts, imp_trib: voucher.imp_trib, imp_total: voucher.imp_total };
}

/** How much ARCA's total carries above the voucher's parts beyond the
 *  rounding cent (percepciones it did not itemize, or a voucher listed with
 *  only its total), or null. The person accepting it says where it goes. */
export function receivedVoucherGap(
  voucher: Parameters<typeof receivedVoucherAmounts>[0],
): number | null {
  const a = receivedVoucherAmounts(voucher);
  const gap = round2(
    a.imp_total -
      (a.imp_neto +
        a.imp_no_gravado +
        a.imp_op_exentas +
        a.imp_iva +
        a.imp_trib),
  );
  return gap > ROUNDING_CENT ? gap : null;
}

/** The amounts with the gap where the person put it: otros tributos, or no
 *  gravado (the net on a B or C, where everything is net). The IVA and the
 *  total stay ARCA's. */
export function placeReceivedGap(
  amounts: ReceivedAmounts,
  letter: string | null,
  gap: number,
  target: ArcaGapTarget,
): ReceivedAmounts {
  if (target === "otros_tributos") {
    return { ...amounts, imp_trib: round2(amounts.imp_trib + gap) };
  }
  return ivaIsComputable(letter)
    ? { ...amounts, imp_no_gravado: round2(amounts.imp_no_gravado + gap) }
    : { ...amounts, imp_neto: round2(amounts.imp_neto + gap) };
}

/** The tray's flag for a voucher with a gap. */
export function receivedGapText(gap: number, moneda: "PES" | "DOL"): string {
  return `Los importes de ARCA no suman el total (diferencia ${formatMoney(gap, moneda === "DOL" ? "USD" : "ARS")})`;
}

/** The choice as the accept dialog names it. */
export function arcaGapTargetLabel(
  target: ArcaGapTarget,
  letter: string | null,
): string {
  if (target === "otros_tributos") return "Otros tributos (percepciones)";
  return ivaIsComputable(letter) ? "No gravado" : "Neto";
}

/** ARCA's per-tribute columns, keyed as the purchase stores them. */
export function receivedTributeSplit(
  voucher: Pick<ReceivedVoucher, "trib_breakdown">,
): Partial<Record<TributeField, number>> {
  const b = voucher.trib_breakdown;
  const split: Partial<Record<TributeField, number>> = {};
  if (b.perc_iva !== undefined) split.imp_perc_iva = b.perc_iva;
  if (b.perc_nacionales !== undefined) {
    split.imp_perc_nacionales = b.perc_nacionales;
  }
  if (b.perc_iibb !== undefined) split.imp_perc_iibb = b.perc_iibb;
  if (b.municipales !== undefined) split.imp_perc_municipales = b.municipales;
  if (b.internos !== undefined) split.imp_impuestos_internos = b.internos;
  return split;
}

/** The alícuotas a received voucher with only neto and IVA totals is read
 *  against: 21 % (most), 10,5 % (vehicles, bank interest), 27 % (telephony,
 *  energy). */
const HEADER_ONLY_RATES = [
  IVA_RATE.TWENTY_ONE,
  IVA_RATE.TEN_FIVE,
  IVA_RATE.TWENTY_SEVEN,
] as const;

/** How far the IVA may be from neto × alícuota: 0,5 % of that amount, and at
 *  least a cent for rounding. */
const HEADER_ONLY_RATE_TOLERANCE = 0.005;

/**
 * The alícuota of a voucher that gives only its neto and IVA totals: the
 * nearest of 21, 10,5 and 27 % within tolerance. Anything else (several
 * alícuotas mixed) falls back to 21 % with `mixed`, for the user to review.
 * Null when there is no IVA to read a rate from.
 */
export function inferVoucherIvaRate(
  neto: number,
  iva: number,
): { iva_rate_id: (typeof HEADER_ONLY_RATES)[number]; mixed: boolean } | null {
  if (!(neto > 0) || !(iva > 0)) return null;
  let best: { id: (typeof HEADER_ONLY_RATES)[number]; gap: number } | null =
    null;
  for (const id of HEADER_ONLY_RATES) {
    const expected = (neto * IVA_RATE_PERCENT[id]) / 100;
    const gap = Math.abs(iva - expected);
    if (gap > Math.max(0.01, expected * HEADER_ONLY_RATE_TOLERANCE)) continue;
    if (!best || gap < best.gap) best = { id, gap };
  }
  return best
    ? { iva_rate_id: best.id, mixed: false }
    : { iva_rate_id: IVA_RATE.TWENTY_ONE, mixed: true };
}

const MIXED_RATES_WARNING =
  "ARCA no detalla las alícuotas y el IVA no coincide con 21 %, 10,5 % ni 27 % del neto: se carga al 21 %. Revisá las alícuotas.";

/** One line per alícuota for a letter A voucher whose export lists them and
 *  ties to the cent with its neto and IVA (the items would rewrite the
 *  header); one line at the inferred alícuota when the export gives only the
 *  totals; empty otherwise, and the purchase is saved header-only. */
type ReceivedItem = {
  description: string;
  quantity: number;
  unit_price: number;
  iva_rate_id: PurchaseIvaRateId;
  line_neto: number;
  line_iva: number;
  line_total: number;
  sort_order: number;
};

export function receivedVoucherItems(
  voucher: Parameters<typeof receivedVoucherAmounts>[0] &
    Pick<ReceivedVoucher, "iva_breakdown">,
): ReceivedItem[] {
  const lines = arcaLines(voucher);
  // The purchase's total is recomputed from its lines: a rounding cent
  // receivedVoucherAmounts moved into the net goes to the largest line too,
  // or the saved total would drift a cent from ARCA's.
  const neto = receivedVoucherAmounts(voucher).imp_neto;
  const gap = round2(neto - lines.reduce((a, l) => a + l.line_neto, 0));
  if (lines.length === 0 || gap === 0) return lines;
  const largest = lines.reduce((best, l) =>
    l.line_neto > best.line_neto ? l : best,
  );
  return lines.map((l) => {
    if (l !== largest) return l;
    const lineNeto = round2(l.line_neto + gap);
    return {
      ...l,
      unit_price: lineNeto,
      line_neto: lineNeto,
      line_total: round2(lineNeto + l.line_iva),
    };
  });
}

function arcaLines(
  voucher: Pick<
    ReceivedVoucher,
    "letter" | "iva_breakdown" | "imp_neto_gravado" | "imp_iva"
  >,
): ReceivedItem[] {
  if (voucher.letter !== "A") return [];
  if (voucher.iva_breakdown.length === 0) {
    const neto = round2(voucher.imp_neto_gravado);
    const iva = round2(voucher.imp_iva);
    const rate = inferVoucherIvaRate(neto, iva);
    if (!rate) return [];
    return [
      {
        description: "Según ARCA → Mis Comprobantes",
        quantity: 1,
        unit_price: neto,
        iva_rate_id: rate.iva_rate_id,
        line_neto: neto,
        line_iva: iva,
        line_total: round2(neto + iva),
        sort_order: 0,
      },
    ];
  }
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
  let tributes = receivedTributeSplit(voucher);
  const kind = voucher.kind ?? "factura";
  const warnings: string[] = [];
  if (kind !== "factura") warnings.push("NC/ND: elegí la factura de origen.");
  if (voucher.moneda === "DOL") warnings.push("USD: revisá la cotización.");
  if (
    voucher.letter === "A" &&
    voucher.iva_breakdown.length === 0 &&
    inferVoucherIvaRate(voucher.imp_neto_gravado, voucher.imp_iva)?.mixed
  ) {
    warnings.push(MIXED_RATES_WARNING);
  }
  if (amounts.imp_trib > 0 && Object.keys(tributes).length === 0) {
    // ARCA gives only the total: a suggestion the user confirms or edits.
    const suggestion = suggestTributeSplit({
      trib: amounts.imp_trib,
      netoGravado: amounts.imp_neto,
      ivaComputable: ivaIsComputable(voucher.letter),
      history: voucher.tribute_history ?? null,
    });
    if (suggestion) {
      tributes = suggestion.split;
      warnings.push(TRIBUTE_SUGGESTION_NOTE[suggestion.basis]);
    }
  }
  return {
    supplier: voucher.supplier,
    unmatchedSupplier: voucher.supplier
      ? null
      : { legal_name: voucher.issuer_name, cuit: voucher.issuer_cuit },
    kind,
    kind_read: voucher.kind !== null,
    letter: voucher.letter,
    punto_venta: voucher.punto_venta,
    numero: voucher.numero,
    fecha: voucher.fecha,
    // The supplier's payment term moves it once the supplier is picked.
    fch_vto_pago: voucher.fecha,
    cae_proveedor: voucher.cae,
    cae_vto_proveedor: null,
    imp_neto: amounts.imp_neto,
    imp_iva: amounts.imp_iva,
    imp_trib: amounts.imp_trib,
    imp_total: amounts.imp_total,
    imp_no_gravado: amounts.imp_no_gravado,
    imp_op_exentas: amounts.imp_op_exentas,
    arca_gap: receivedVoucherGap(voucher),
    tributes,
    moneda: voucher.moneda,
    cotizacion: voucher.moneda === "DOL" ? voucher.cotizacion : 1,
    motivo_nc_nd: kind === "factura" ? null : "Según ARCA → Mis Comprobantes",
    items: [],
    arca_lines: receivedVoucherItems(voucher).map((l) => ({
      iva_rate_id: l.iva_rate_id,
      neto: l.line_neto,
      iva: l.line_iva,
    })),
    account: null,
    cost_center_id: null,
    warnings,
  };
}

/** A purchase prefilled from a voucher whose amounts did not read, or whose
 *  type does not load by itself: its identity from ARCA, the amounts (and,
 *  for an unsupported type, the kind and letter) for the person to type from
 *  the invoice (what ARCA listed is shown as a note). */
export function unreadableVoucherToDraft(
  voucher: ReceivedVoucher,
): PurchaseInvoiceDraftData {
  const kind = voucher.kind ?? "factura";
  const listed = rawAmountsText(voucher.raw_amounts);
  return {
    supplier: voucher.supplier,
    unmatchedSupplier: voucher.supplier
      ? null
      : { legal_name: voucher.issuer_name, cuit: voucher.issuer_cuit },
    kind,
    kind_read: voucher.kind !== null,
    letter: voucher.letter,
    punto_venta: voucher.punto_venta,
    numero: voucher.numero,
    fecha: voucher.fecha,
    fch_vto_pago: voucher.fecha,
    cae_proveedor: voucher.cae,
    cae_vto_proveedor: null,
    imp_neto: null,
    imp_iva: null,
    imp_trib: null,
    imp_total: null,
    moneda: voucher.moneda,
    cotizacion: voucher.moneda === "DOL" ? null : 1,
    motivo_nc_nd: kind === "factura" ? null : "Según ARCA → Mis Comprobantes",
    items: [],
    account: null,
    cost_center_id: null,
    warnings: [
      voucher.status === "unsupported"
        ? `ARCA lo informa como tipo ${voucher.cbte_tipo}, que no se carga solo: elegí la clase y la letra y cargá los importes del comprobante.`
        : `ARCA no se pudo leer${listed ? ` (lista ${listed})` : ""}: cargá los importes de la factura.`,
      ...(kind !== "factura" ? ["NC/ND: elegí la factura de origen."] : []),
    ],
  };
}

/** What ARCA listed for an unreadable voucher, as one line. */
export function rawAmountsText(raw: ReceivedVoucher["raw_amounts"]): string {
  if (!raw) return "";
  return RAW_AMOUNT_KEYS.filter((k) => raw[k] !== undefined)
    .map((k) => `${RAW_AMOUNT_LABEL[k].toLowerCase()} ${raw[k]}`)
    .join(", ");
}

const RAW_AMOUNT_KEYS = Object.keys(RAW_AMOUNT_LABEL) as RawAmountKey[];
