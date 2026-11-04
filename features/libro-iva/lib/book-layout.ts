// The layout the three surfaces of each libro IVA share (screen, PDF and
// Excel): title, short voucher codes, the IVA condition column and the amount
// columns, in the order the legacy book prints them.

import { isIvaCondition, type IvaCondition } from "@/features/clients/schema";
import { periodBounds } from "@/lib/accounting-period";
import { CONDICION_IVA_RECEPTOR } from "@/lib/afip/codes";
import { formatNumber2 } from "@/lib/format";

import {
  COMPRAS_AMOUNT_COLUMNS,
  COMPRAS_PERCEPTIONS_HEADER,
  comprasPerceptions,
  comprasPerceptionsTotal,
  computeComprasTotals,
  computeTotals,
  countSuspectRates,
  foreignCurrencyTotals,
  groupByInvoice,
  groupComprasByInvoice,
  IVA_RATES,
  libroIvaVoucherNumber,
  type ComprasBreakdown,
  type LibroIvaComprasRow,
  type LibroIvaVentasRow,
  type PerRate,
  SIN_ALICUOTA,
  SIN_ALICUOTA_LABEL,
  SIN_DISCRIMINAR,
  SIN_DISCRIMINAR_LABEL,
  VENTAS_AMOUNT_COLUMNS,
} from "../schema";

export type LibroIvaBook = "ventas" | "compras";

/** The title block of every surface. */
export type LibroIvaHeader = {
  companyName: string;
  cuit: string;
  /** The period is in `accounting_closed_periods`: the book is final. */
  closed: boolean;
};

const BOOK_NAME: Record<LibroIvaBook, string> = {
  ventas: "Ventas",
  compras: "Compras",
};

/** "01/09/2026" from "2026-09-01". */
function ddmmyyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** "Libro de I.V.A. Compras (01/09/2026 - 30/09/2026) - Previo". */
export function libroIvaTitle(
  book: LibroIvaBook,
  period: string,
  closed: boolean,
): string {
  const { from, to } = periodBounds(period);
  return `Libro de I.V.A. ${BOOK_NAME[book]} (${ddmmyyyy(from)} - ${ddmmyyyy(to)}) - ${closed ? "Definitivo" : "Previo"}`;
}

/** "C.U.I.T.: 30-71234567-8", or nothing when the CUIT is unknown. */
export function companyCuitLabel(cuit: string): string {
  return cuit ? `C.U.I.T.: ${formatDocNumber(cuit)}` : "";
}

/** The TC column: FC, NC, ND. */
const TC_CODE: Record<string, string> = { factura: "FC", nc: "NC", nd: "ND" };

export function tcCode(kind: string): string {
  return TC_CODE[kind] ?? kind.toUpperCase();
}

export const TC_LEGEND =
  "TC: FC = factura, NC = nota de crédito (importes en negativo), ND = nota de débito.";

/** A credit note subtracts: the books print every amount of it negative. */
export function kindSign(kind: string): 1 | -1 {
  return kind === "nc" ? -1 : 1;
}

/** The C.I. column: the counterparty's IVA condition in two letters. */
const CONDITION_CODE: Record<IvaCondition, string> = {
  responsable_inscripto: "RI",
  monotributo: "RM",
  exento: "EX",
  consumidor_final: "CF",
  no_categorizado: "NC",
};

const RECEPTOR_CODE: Record<number, string> = {
  [CONDICION_IVA_RECEPTOR.RESPONSABLE_INSCRIPTO]: "RI",
  [CONDICION_IVA_RECEPTOR.EXENTO]: "EX",
  [CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL]: "CF",
  [CONDICION_IVA_RECEPTOR.MONOTRIBUTO]: "RM",
  [CONDICION_IVA_RECEPTOR.NO_CATEGORIZADO]: "NC",
  [CONDICION_IVA_RECEPTOR.PROVEEDOR_EXTERIOR]: "PE",
  [CONDICION_IVA_RECEPTOR.CLIENTE_EXTERIOR]: "CE",
  [CONDICION_IVA_RECEPTOR.IVA_LIBERADO]: "LI",
  [CONDICION_IVA_RECEPTOR.MONOTRIBUTO_SOCIAL]: "RM",
  [CONDICION_IVA_RECEPTOR.IVA_NO_ALCANZADO]: "NA",
  [CONDICION_IVA_RECEPTOR.MONOTRIBUTO_PROMOVIDO]: "RM",
};

export const CONDITION_LEGEND =
  "C.I.: RI = responsable inscripto, RM = monotributo, EX = exento, CF = consumidor final, NC = no categorizado.";

/** The counterparty's condition: on a sale, the one informed to AFIP with the
 *  voucher (RG 5616) when stored, else the client's; on a purchase, the
 *  supplier's. Null when neither is known. */
export function ivaConditionCode(
  receptor: number | null,
  partyCondition: string | null,
): string | null {
  if (receptor !== null && RECEPTOR_CODE[receptor]) {
    return RECEPTOR_CODE[receptor];
  }
  return isIvaCondition(partyCondition) ? CONDITION_CODE[partyCondition] : null;
}

export type RateColumn = { id: number; label: string };

/** The alícuotas a set of vouchers uses, in ascending order, then "Sin
 *  alícuota" when a voucher's rate could not be inferred, then the B/C
 *  purchases. A month with only 21% prints one Neto/IVA pair. */
export function presentRates(
  docs: readonly { per_rate: PerRate }[],
): RateColumn[] {
  const used = (id: number) =>
    docs.some((d) => {
      const v = d.per_rate[id];
      return v !== undefined && (v.neto !== 0 || v.iva !== 0);
    });
  return [
    ...IVA_RATES.filter((r) => used(r.id)).map((r) => ({
      id: r.id,
      label: r.label,
    })),
    ...(used(SIN_ALICUOTA)
      ? [{ id: SIN_ALICUOTA, label: SIN_ALICUOTA_LABEL }]
      : []),
    ...(used(SIN_DISCRIMINAR)
      ? [{ id: SIN_DISCRIMINAR, label: SIN_DISCRIMINAR_LABEL }]
      : []),
  ];
}

/**
 * One amount column. `value` reads a voucher (positive, as the RPC returns
 * it) or the period totals (already signed) alike, so a column's total is
 * the same accessor over `computeTotals` / `computeComprasTotals`.
 */
export type AmountColumn<F> = {
  key: string;
  /** The rate label over a Neto/IVA pair; null for a single column. */
  group: string | null;
  header: string;
  value: (f: F) => number;
  /** Perceptions, one line per type with its code (compras). */
  lines?: (f: F) => { code: string; amount: number }[];
};

/** A Neto/IVA pair per alícuota; B/C purchases get one column, their amount
 *  with the IVA included, since it is not discriminated. */
function rateColumns<F extends { per_rate: PerRate }>(
  rates: readonly RateColumn[],
): AmountColumn<F>[] {
  return rates.flatMap((r) =>
    r.id === SIN_DISCRIMINAR
      ? [
          {
            key: `neto-${r.id}`,
            group: r.label,
            header: "Importe",
            value: (f: F) => f.per_rate[r.id]?.neto ?? 0,
          },
        ]
      : [
          {
            key: `neto-${r.id}`,
            group: r.label,
            header: "Neto",
            value: (f: F) => f.per_rate[r.id]?.neto ?? 0,
          },
          {
            key: `iva-${r.id}`,
            group: r.label,
            header: "IVA",
            value: (f: F) => f.per_rate[r.id]?.iva ?? 0,
          },
        ],
  );
}

export type VentasFigures = {
  per_rate: PerRate;
  imp_trib: number;
  imp_op_ex: number;
  imp_tot_conc: number;
  imp_total: number;
};

const TOTAL_HEADER = "Total";
const VENTAS_PERCEPTIONS_HEADER = "Percepciones";

/** Ventas: Neto/IVA per alícuota, No gravado, Exento, Percepciones, Total. */
export function ventasAmountColumns(
  rates: readonly RateColumn[],
): AmountColumn<VentasFigures>[] {
  return [
    ...rateColumns<VentasFigures>(rates),
    ...VENTAS_AMOUNT_COLUMNS.map((c) => ({
      key: c.header,
      group: null,
      header: c.header,
      value: c.value,
    })),
    {
      key: "percepciones",
      group: null,
      header: VENTAS_PERCEPTIONS_HEADER,
      value: (f) => f.imp_trib,
    },
    {
      key: "total",
      group: null,
      header: TOTAL_HEADER,
      value: (f) => f.imp_total,
    },
  ];
}

export type ComprasFigures = {
  per_rate: PerRate;
  breakdown: ComprasBreakdown;
  imp_total: number;
};

/** Compras: Neto/IVA per alícuota, Imp. int., No gravado, Exento,
 *  Percepciones (one line per type with its letter), Total. */
export function comprasAmountColumns(
  rates: readonly RateColumn[],
): AmountColumn<ComprasFigures>[] {
  return [
    ...rateColumns<ComprasFigures>(rates),
    ...COMPRAS_AMOUNT_COLUMNS.map((c) => ({
      key: c.header,
      group: null,
      header: c.header,
      value: (f: ComprasFigures) => c.value(f.breakdown),
    })),
    {
      key: "percepciones",
      group: null,
      header: COMPRAS_PERCEPTIONS_HEADER,
      value: (f) => comprasPerceptionsTotal(f.breakdown),
      lines: (f) => comprasPerceptions(f.breakdown),
    },
    {
      key: "total",
      group: null,
      header: TOTAL_HEADER,
      value: (f) => f.imp_total,
    },
  ];
}

/** A voucher's cell as the book prints it: signed (NC negative), blank at
 *  zero except the Total. */
export function voucherAmount<F>(
  col: AmountColumn<F>,
  figures: F,
  kind: string,
): number | null {
  const v = kindSign(kind) * col.value(figures);
  return v === 0 && col.key !== "total" ? null : v;
}

/** The perception lines of a voucher, signed like its other amounts. */
export function voucherLines<F>(
  col: AmountColumn<F>,
  figures: F,
  kind: string,
): { code: string; amount: number }[] {
  const sign = kindSign(kind);
  return (col.lines?.(figures) ?? []).map((p) => ({
    code: p.code,
    amount: sign * p.amount,
  }));
}

/** One voucher as every surface prints it. */
export type BookDoc<F> = {
  id: string;
  fecha: string;
  kind: string;
  number: string;
  party: string;
  cuit: string;
  ci: string | null;
  cae: string | null;
  caeVto: string | null;
  moneda: string;
  cotizacion: number;
  /** The voucher's total in its own currency (positive, as stored). */
  origTotal: number;
  figures: F;
};

type GroupedDoc = {
  kind: string;
  has_items: boolean;
  per_rate: PerRate;
  moneda: string;
  cotizacion: number;
  imp_total: number;
  orig: { imp_total: number };
};

/** A libro ready to print: its vouchers, the columns the period needs, the
 *  period totals and the running subtotals. */
export type BookModel<F> = {
  book: LibroIvaBook;
  partyHeader: string;
  caeHeader: string;
  docs: BookDoc<F>[];
  /** The grouped vouchers, for the currency and items notes. */
  grouped: readonly GroupedDoc[];
  columns: AmountColumn<F>[];
  /** `computeTotals` / `computeComprasTotals` of the whole period. */
  totals: F & { count: number };
  /** The same totals over the first `n` vouchers (a page's subtotal). */
  totalsOfFirst: (n: number) => F & { count: number };
};

/** "30-71234567-8" for an 11-digit CUIT; any other document as stored. */
export function formatDocNumber(doc: string | null): string {
  if (!doc) return "";
  const digits = doc.replace(/\D/g, "");
  return digits.length === 11
    ? `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
    : doc;
}

export function ventasBook(
  rows: readonly LibroIvaVentasRow[],
): BookModel<VentasFigures> {
  const grouped = groupByInvoice(rows);
  return {
    book: "ventas",
    partyHeader: "Razón social",
    caeHeader: "CAE",
    grouped,
    docs: grouped.map((g) => ({
      id: g.invoice_id,
      fecha: g.fecha,
      kind: g.kind,
      number: libroIvaVoucherNumber(g),
      party: g.client_legal_name,
      cuit: formatDocNumber(g.doc_nro),
      ci: g.ci,
      cae: g.cae,
      caeVto: g.cae_vencimiento,
      moneda: g.moneda,
      cotizacion: g.cotizacion,
      origTotal: g.orig.imp_total,
      figures: g,
    })),
    columns: ventasAmountColumns(presentRates(grouped)),
    totals: computeTotals(grouped),
    totalsOfFirst: (n) => computeTotals(grouped.slice(0, n)),
  };
}

export function comprasBook(
  rows: readonly LibroIvaComprasRow[],
): BookModel<ComprasFigures> {
  const grouped = groupComprasByInvoice(rows);
  return {
    book: "compras",
    partyHeader: "Razón social",
    caeHeader: "CAE prov.",
    grouped,
    docs: grouped.map((g) => ({
      id: g.purchase_invoice_id,
      fecha: g.fecha,
      kind: g.kind,
      number: libroIvaVoucherNumber(g),
      party: g.supplier_legal_name,
      cuit: formatDocNumber(g.supplier_cuit),
      ci: g.ci,
      cae: g.cae_proveedor,
      caeVto: g.cae_vto_proveedor,
      moneda: g.moneda,
      cotizacion: g.cotizacion,
      origTotal: g.orig.imp_total,
      figures: g,
    })),
    columns: comprasAmountColumns(presentRates(grouped)),
    totals: computeComprasTotals(grouped),
    totalsOfFirst: (n) => computeComprasTotals(grouped.slice(0, n)),
  };
}

/** Spreadsheet / print currency of an AFIP code: dollars as USD. */
export function printCurrency(moneda: string): string {
  return moneda === "DOL" || moneda === "USD" ? "USD" : moneda;
}

/** The notes the PDF and the Excel print with the book: what the peso
 *  figures include in foreign currency, vouchers left at rate 1, vouchers
 *  under "Sin alícuota", B/C purchases, then the given legends. */
export function bookNotes<F>(
  model: BookModel<F>,
  legends: readonly string[],
): string[] {
  const foreign = foreignCurrencyTotals(model.grouped);
  const suspect = countSuspectRates(model.grouped);
  const unrated = model.grouped.filter(
    (g) => g.per_rate[SIN_ALICUOTA] !== undefined,
  ).length;
  const undiscriminated = model.grouped.filter(
    (g) => g.per_rate[SIN_DISCRIMINAR] !== undefined,
  ).length;
  return [
    ...(foreign.length > 0
      ? [
          "Importes en pesos, como en el asiento de cada comprobante (moneda extranjera a su cotización).",
          ...foreign.map(
            (f) =>
              `${f.count} en ${f.moneda === "DOL" ? "dólares" : f.moneda}: ${printCurrency(f.moneda)} ${formatNumber2(f.imp_total_orig)} = $ ${formatNumber2(f.imp_total_ars)}`,
          ),
        ]
      : []),
    ...(suspect > 0
      ? [
          `${suspect} comprobante(s) en moneda extranjera sin cotización (cotización 1): quedan sin convertir.`,
        ]
      : []),
    ...(unrated > 0
      ? [
          `${unrated} comprobante(s) sin ítems cuyo IVA / neto no cierra con ninguna alícuota: van en «${SIN_ALICUOTA_LABEL}» y el TXT los excluye.`,
        ]
      : []),
    ...(undiscriminated > 0 ? [undiscriminatedNote(undiscriminated)] : []),
    ...legends,
  ];
}

/** B/C purchases: why they have no alícuota, as the TXT declares them. */
export function undiscriminatedNote(count: number): string {
  return `${count} comprobante(s) B o C: el IVA no se discrimina, así que van en «${SIN_DISCRIMINAR_LABEL}» con el IVA incluido y el TXT los declara sin alícuota.`;
}

/** A totals cell (the figures already signed): blank at zero except Total. */
export function totalsAmount<F>(
  col: AmountColumn<F>,
  totals: F,
): number | null {
  const v = col.value(totals);
  return v === 0 && col.key !== "total" ? null : v;
}
