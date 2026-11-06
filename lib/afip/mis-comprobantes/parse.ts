import "server-only";

import {
  findHeaderRowIndex,
  normalizeHeader,
  parseSheetDate,
} from "@/lib/tables/columns";
import type { ParsedTable } from "@/lib/tables/csv";
import { decodeText, readUploadedTable } from "@/lib/tables/read-upload";
import { parseStatementNumber, round2 } from "@/lib/format";

import {
  ivaRateIdForPercent,
  purchaseKindLetterForCbteTipo,
  type InvoiceKind,
  type InvoiceLetter,
  type IvaRateId,
} from "../codes";

// The file ARCA gives under Mis Comprobantes → Recibidos (CSV or Excel), read
// into vouchers for the tray (arca_received_vouchers). Columns are found by
// header; an old 30-column TSV without a known header is read by position.

export const RECEIVED_EXPORT_LIMITS = {
  rows: 5001,
  columns: 60,
  cellChars: 500,
} as const;

const TOO_MANY =
  "El archivo tiene más de 5000 comprobantes: exportá un rango de fechas más corto.";
const NO_HEADER =
  "No se reconocen las columnas: subí el archivo de ARCA → Mis Comprobantes → Recibidos sin editar.";

export type TribBreakdown = Partial<
  Record<
    "perc_iva" | "perc_nacionales" | "perc_iibb" | "municipales" | "internos",
    number
  >
>;

export type IvaBreakdownLine = {
  iva_rate_id: IvaRateId;
  neto: number;
  iva: number;
};

export type ReceivedVoucher = {
  issuer_cuit: string;
  issuer_name: string;
  cbte_tipo: number;
  /** null for a type the ERP does not model (FCE, M…): unsupported. */
  kind: InvoiceKind | null;
  letter: InvoiceLetter | null;
  punto_venta: number;
  numero: number;
  fecha: string;
  cae: string | null;
  moneda: "PES" | "DOL";
  cotizacion: number | null;
  imp_neto_gravado: number;
  imp_no_gravado: number;
  imp_op_exentas: number;
  imp_iva: number;
  imp_trib: number;
  imp_total: number;
  trib_breakdown: TribBreakdown;
  iva_breakdown: IvaBreakdownLine[];
};

export type SkipReason =
  | "bad_date"
  | "bad_type"
  | "bad_number"
  | "bad_cuit"
  | "bad_amount"
  | "amount_over_total"
  | "breakdown_mismatch";

/** Why a row's amounts were not read, when its identity was. */
export const UNREADABLE_REASONS = [
  "bad_amount",
  "amount_over_total",
  "breakdown_mismatch",
] as const;
export type UnreadableReason = (typeof UNREADABLE_REASONS)[number];

function isUnreadableReason(r: SkipReason): r is UnreadableReason {
  return (UNREADABLE_REASONS as readonly string[]).includes(r);
}

/** The amounts of an unreadable row as ARCA lists them (text, unparsed). */
export type RawAmounts = Partial<
  Record<
    "neto" | "no_gravado" | "exentas" | "iva" | "otros_tributos" | "total",
    string
  >
>;

/** A row whose identity reads but whose amounts do not: kept in the tray as
 *  «No se pudieron leer», with what ARCA listed. */
export type UnreadableVoucher = Pick<
  ReceivedVoucher,
  | "issuer_cuit"
  | "issuer_name"
  | "cbte_tipo"
  | "kind"
  | "letter"
  | "punto_venta"
  | "numero"
  | "fecha"
  | "cae"
> & {
  moneda: "PES" | "DOL";
  unreadable_reason: UnreadableReason;
  raw_amounts: RawAmounts;
};

/** A row that was not read, named as ARCA lists it so a person can find it
 *  (tipo, punto de venta-número, CUIT emisor; whatever the row has). */
export type SkippedRow = { reason: SkipReason; ref: string };

/** How many skipped rows are named; the rest are only counted. */
export const SKIPPED_ROWS_NAMED = 20;

export type ParsedReceivedExport = {
  vouchers: ReceivedVoucher[];
  /** Skipped rows whose identity reads (also counted in skippedByReason). */
  unreadable: UnreadableVoucher[];
  skippedByReason: Partial<Record<SkipReason, number>>;
  skipped: SkippedRow[];
};

const FIELDS = [
  "fecha",
  "tipo",
  "punto_venta",
  "numero",
  "cae",
  "cuit",
  "denominacion",
  "tipo_cambio",
  "moneda",
  "neto_gravado",
  "no_gravado",
  "exentas",
  "otros_tributos",
  "iva",
  "total",
  "perc_iva",
  "perc_nacionales",
  "perc_iibb",
  "municipales",
  "internos",
] as const;
type Field = (typeof FIELDS)[number];

const TRIBUTE_FIELDS = [
  "perc_iva",
  "perc_nacionales",
  "perc_iibb",
  "municipales",
  "internos",
] as const satisfies readonly Field[];

const REQUIRED: readonly Field[] = [
  "fecha",
  "tipo",
  "punto_venta",
  "numero",
  "cuit",
  "total",
];

// Normalized headers (normalizeHeader) as ARCA writes them.
const ALIASES: Readonly<Record<Field, readonly string[]>> = {
  fecha: ["fecha de emision", "fecha emision", "fecha"],
  tipo: ["tipo de comprobante", "tipo comprobante", "tipo"],
  punto_venta: ["punto de venta", "pto vta", "punto venta"],
  numero: ["numero desde", "nro desde", "numero de comprobante", "numero"],
  cae: ["cod autorizacion", "codigo de autorizacion", "cae"],
  cuit: [
    "nro doc emisor",
    "nro documento emisor",
    "numero doc emisor",
    "cuit emisor",
    "nro doc",
  ],
  denominacion: ["denominacion emisor", "razon social emisor", "denominacion"],
  tipo_cambio: ["tipo cambio", "tipo de cambio"],
  moneda: ["moneda"],
  neto_gravado: [
    "imp neto gravado",
    "imp neto gravado total",
    "neto gravado total",
    "neto gravado",
  ],
  no_gravado: ["imp neto no gravado", "neto no gravado"],
  exentas: ["imp op exentas", "op exentas"],
  otros_tributos: ["otros tributos", "imp otros tributos"],
  iva: ["iva", "total iva", "imp iva"],
  total: ["imp total", "importe total", "total"],
  perc_iva: ["percepciones de iva", "percepcion iva", "perc iva"],
  perc_nacionales: [
    "percepciones de otros impuestos nacionales",
    "percepcion otros impuestos nacionales",
    "percepciones de ganancias",
    "percepcion ganancias",
  ],
  perc_iibb: [
    "percepciones de ingresos brutos",
    "percepcion iibb",
    "perc iibb",
  ],
  municipales: ["impuestos municipales", "imp municipales"],
  internos: ["impuestos internos", "imp internos"],
};

// The 30-column TSV ARCA exported before, which the retired bulk importer read.
const POSITIONAL_30_COLUMNS: Readonly<Partial<Record<Field, number>>> = {
  fecha: 0,
  tipo: 1,
  punto_venta: 2,
  numero: 3,
  cae: 5,
  cuit: 7,
  denominacion: 8,
  moneda: 12,
  neto_gravado: 24,
  no_gravado: 25,
  exentas: 26,
  otros_tributos: 27,
  iva: 28,
  total: 29,
};

/** Each header claims one field, exact normalized match only: "iva" must not
 *  take "iva 21". */
function mapColumns(header: readonly string[]): Partial<Record<Field, number>> {
  const normalized = header.map(normalizeHeader);
  const mapping: Partial<Record<Field, number>> = {};
  const used = new Set<number>();
  for (const field of FIELDS) {
    for (const alias of ALIASES[field]) {
      const index = normalized.findIndex((h, i) => !used.has(i) && h === alias);
      if (index >= 0) {
        mapping[field] = index;
        used.add(index);
        break;
      }
    }
  }
  return mapping;
}

/** Per-rate columns ("Imp. Neto Gravado IVA 21%", "Neto Grav. IVA 21%",
 *  "IVA 21%"), by AFIP rate. */
function mapRateColumns(
  header: readonly string[],
): Map<IvaRateId, { neto?: number; iva?: number }> {
  const out = new Map<IvaRateId, { neto?: number; iva?: number }>();
  header.map(normalizeHeader).forEach((h, i) => {
    const m =
      /^(?:(imp neto gravado|neto gravado|neto grav) )?iva (\d+(?: \d+)?)$/.exec(
        h,
      );
    if (!m) return;
    const rate = ivaRateIdForPercent(Number(m[2]!.replace(" ", ".")));
    if (rate === null) return;
    const entry = out.get(rate) ?? {};
    if (m[1]) entry.neto = i;
    else entry.iva = i;
    out.set(rate, entry);
  });
  return out;
}

/** "1", "001", "1 - Factura A". */
function parseTipo(raw: string): number | null {
  const m = /^\s*(\d{1,3})\b/.exec(raw);
  return m ? Number(m[1]) : null;
}

function parsePositiveInt(raw: string): number | null {
  const digits = raw.trim();
  if (!/^\d{1,13}$/.test(digits)) return null;
  const n = Number(digits);
  return n > 0 ? n : null;
}

/** A missing column reads as 0; a present cell that is not a number is null. */
function parseAmount(
  row: readonly string[],
  index: number | undefined,
): number | null {
  if (index === undefined) return 0;
  const raw = (row[index] ?? "").trim();
  if (raw === "") return 0;
  const n = parseStatementNumber(raw);
  return n === null ? null : round2(Math.abs(n));
}

function parseMoneda(raw: string): "PES" | "DOL" | null {
  const v = raw.trim().toUpperCase();
  if (v === "" || v === "$" || v === "PES" || v === "ARS") return "PES";
  if (v === "DOL" || v === "USD" || v === "U$S" || v === "US$") return "DOL";
  return null;
}

/** An amount in whole cents: compared this way, a rounding cent is 1, never
 *  0.0100000000002. */
const cents = (n: number) => Math.round(n * 100);
const near = (a: number, b: number) => Math.abs(cents(a) - cents(b)) <= 1;

type Identity = {
  fecha: string;
  cbteTipo: number;
  puntoVenta: number;
  numero: number;
  cuit: string;
};

/** What identifies a row: its date, type, number and issuer. */
function parseIdentity(
  row: readonly string[],
  cols: Partial<Record<Field, number>>,
): Identity | SkipReason {
  const cell = (f: Field) =>
    cols[f] === undefined ? "" : (row[cols[f]!] ?? "").trim();
  const fecha = parseSheetDate(cell("fecha"));
  if (!fecha) return "bad_date";
  const cbteTipo = parseTipo(cell("tipo"));
  if (cbteTipo === null) return "bad_type";
  const puntoVenta = parsePositiveInt(cell("punto_venta"));
  const numero = parsePositiveInt(cell("numero"));
  if (puntoVenta === null || numero === null) return "bad_number";
  const cuit = cell("cuit").replace(/\D/g, "");
  if (!/^\d{11}$/.test(cuit)) return "bad_cuit";
  return { fecha, cbteTipo, puntoVenta, numero, cuit };
}

/** A row whose amounts did not read, with its identity and what ARCA
 *  listed; null when its identity does not read either. */
function unreadableRow(
  row: readonly string[],
  cols: Partial<Record<Field, number>>,
  reason: UnreadableReason,
): UnreadableVoucher | null {
  const identity = parseIdentity(row, cols);
  if (typeof identity === "string") return null;
  const cell = (f: Field) =>
    cols[f] === undefined ? "" : (row[cols[f]!] ?? "").trim();
  const raw: RawAmounts = {};
  for (const [field, key] of RAW_AMOUNT_FIELDS) {
    const v = cell(field);
    if (v !== "") raw[key] = v.slice(0, 40);
  }
  const kl = purchaseKindLetterForCbteTipo(identity.cbteTipo);
  return {
    issuer_cuit: identity.cuit,
    issuer_name: cell("denominacion").slice(0, 300) || identity.cuit,
    cbte_tipo: identity.cbteTipo,
    kind: kl?.kind ?? null,
    letter: kl?.letter ?? null,
    punto_venta: identity.puntoVenta,
    numero: identity.numero,
    fecha: identity.fecha,
    cae: cell("cae").replace(/\D/g, "").slice(0, 20) || null,
    moneda: parseMoneda(cell("moneda")) ?? "PES",
    unreadable_reason: reason,
    raw_amounts: raw,
  };
}

const RAW_AMOUNT_FIELDS: readonly [Field, keyof RawAmounts][] = [
  ["neto_gravado", "neto"],
  ["no_gravado", "no_gravado"],
  ["exentas", "exentas"],
  ["iva", "iva"],
  ["otros_tributos", "otros_tributos"],
  ["total", "total"],
];

function parseRow(
  row: readonly string[],
  cols: Partial<Record<Field, number>>,
  rateCols: Map<IvaRateId, { neto?: number; iva?: number }>,
): ReceivedVoucher | SkipReason {
  const cell = (f: Field) =>
    cols[f] === undefined ? "" : (row[cols[f]!] ?? "").trim();

  const identity = parseIdentity(row, cols);
  if (typeof identity === "string") return identity;
  const { fecha, cbteTipo, puntoVenta, numero, cuit } = identity;
  const moneda = parseMoneda(cell("moneda"));
  if (moneda === null) return "bad_amount";

  const neto = parseAmount(row, cols.neto_gravado);
  const noGravado = parseAmount(row, cols.no_gravado);
  const exentas = parseAmount(row, cols.exentas);
  const trib = parseAmount(row, cols.otros_tributos);
  const iva = parseAmount(row, cols.iva);
  const total = parseAmount(row, cols.total);
  if (
    neto === null ||
    noGravado === null ||
    exentas === null ||
    trib === null ||
    iva === null ||
    total === null
  ) {
    return "bad_amount";
  }

  const tribBreakdown: TribBreakdown = {};
  for (const field of TRIBUTE_FIELDS) {
    if (cols[field] === undefined) continue;
    const v = parseAmount(row, cols[field]);
    if (v === null) return "bad_amount";
    tribBreakdown[field] = v;
  }

  const ivaBreakdown: IvaBreakdownLine[] = [];
  for (const [rate, c] of rateCols) {
    const n = parseAmount(row, c.neto);
    const v = parseAmount(row, c.iva);
    if (n === null || v === null) return "bad_amount";
    if (n !== 0 || v !== 0)
      ivaBreakdown.push({ iva_rate_id: rate, neto: n, iva: v });
  }

  const kl = purchaseKindLetterForCbteTipo(cbteTipo);
  // ARCA lists a B or C with only its total: it is all net, as the purchase
  // stores B and C.
  const onlyTotal =
    (kl?.letter === "B" || kl?.letter === "C") &&
    neto + noGravado + exentas + iva + trib === 0;
  // Some vouchers list the whole net (gravado plus exento and no gravado) as
  // «neto gravado»: the parts then exceed the total by exactly the exento and
  // no gravado, while neto + IVA + tributos is the total.
  const netoIncludesUntaxed =
    !onlyTotal &&
    noGravado + exentas > 0 &&
    cents(neto) >= cents(noGravado + exentas) &&
    Math.abs(cents(neto + iva + trib) - cents(total)) <= 1;
  const netoGravado = onlyTotal
    ? total
    : netoIncludesUntaxed
      ? round2(neto - noGravado - exentas)
      : neto;
  // A total above its parts is kept as ARCA lists it (percepciones it did not
  // itemize, or a voucher with only its total): the person accepting it says
  // where the difference goes. Parts above the total, or a per-rate or
  // per-tribute detail that contradicts its own subtotal, leave no figure to
  // trust, so the row is not read.
  if (
    cents(netoGravado + noGravado + exentas + iva + trib) - cents(total) >
    1
  ) {
    return "amount_over_total";
  }
  if (ivaBreakdown.length > 0) {
    const sumNeto = round2(ivaBreakdown.reduce((a, l) => a + l.neto, 0));
    const sumIva = round2(ivaBreakdown.reduce((a, l) => a + l.iva, 0));
    if (
      !near(sumNeto, netoIncludesUntaxed ? netoGravado : neto) ||
      !near(sumIva, iva)
    )
      return "breakdown_mismatch";
  }
  const tribParts = Object.values(tribBreakdown);
  if (
    tribParts.length > 0 &&
    !near(round2(tribParts.reduce((a, v) => a + v, 0)), trib)
  ) {
    return "breakdown_mismatch";
  }

  const cotizacionRaw = cell("tipo_cambio");
  const cotizacion =
    moneda === "DOL" && cotizacionRaw !== ""
      ? parseStatementNumber(cotizacionRaw)
      : null;

  return {
    issuer_cuit: cuit,
    issuer_name: cell("denominacion").slice(0, 300) || cuit,
    cbte_tipo: cbteTipo,
    kind: kl?.kind ?? null,
    letter: kl?.letter ?? null,
    punto_venta: puntoVenta,
    numero,
    fecha,
    cae: cell("cae").replace(/\D/g, "").slice(0, 20) || null,
    moneda,
    cotizacion: cotizacion !== null && cotizacion > 0 ? cotizacion : null,
    imp_neto_gravado: netoGravado,
    imp_no_gravado: noGravado,
    imp_op_exentas: exentas,
    imp_iva: iva,
    imp_trib: trib,
    imp_total: total,
    trib_breakdown: tribBreakdown,
    iva_breakdown: ivaBreakdown,
  };
}

/** A skipped row as ARCA lists it: «tipo 1 · 00003-00026630 · CUIT …», from
 *  whichever of those cells it has. */
function rowRef(
  row: readonly string[],
  cols: Partial<Record<Field, number>>,
): string {
  const cell = (f: Field) =>
    cols[f] === undefined ? "" : (row[cols[f]!] ?? "").trim();
  const pv = cell("punto_venta").replace(/\D/g, "");
  const numero = cell("numero").replace(/\D/g, "");
  const parts = [
    cell("tipo") && `tipo ${cell("tipo").slice(0, 30)}`,
    (pv || numero) && `${pv.padStart(5, "0")}-${numero.padStart(8, "0")}`,
    cell("cuit") && `CUIT ${cell("cuit").replace(/\D/g, "")}`,
    cell("fecha") && cell("fecha").slice(0, 10),
  ].filter(Boolean);
  return parts.join(" · ").slice(0, 120) || "fila sin datos";
}

/** The amounts of a row whose parts exceed its total, as ARCA lists them,
 *  for a person to see which one is off. */
function amountsRef(
  row: readonly string[],
  cols: Partial<Record<Field, number>>,
): string {
  const cell = (f: Field) =>
    cols[f] === undefined ? "" : (row[cols[f]!] ?? "").trim();
  const parts: [Field, string][] = [
    ["neto_gravado", "neto"],
    ["no_gravado", "no grav."],
    ["exentas", "exento"],
    ["iva", "IVA"],
    ["otros_tributos", "otros trib."],
    ["total", "total"],
  ];
  return parts
    .filter(([f]) => cell(f) !== "")
    .map(([f, label]) => `${label} ${cell(f).slice(0, 20)}`)
    .join(", ");
}

/** Reads a parsed table: header row by alias, or the old 30-column TSV by
 *  position. A row that does not read cleanly is counted, never read as 0. */
export function parseReceivedTable(
  table: ParsedTable,
): ParsedReceivedExport | string {
  if (table.truncated || table.rows.length > 5001) return TOO_MANY;
  const headerIndex = findHeaderRowIndex(table.rows, FIELDS, ALIASES);
  let cols: Partial<Record<Field, number>>;
  let rateCols = new Map<IvaRateId, { neto?: number; iva?: number }>();
  let dataRows: string[][];
  if (headerIndex >= 0) {
    const header = table.rows[headerIndex]!;
    cols = mapColumns(header);
    rateCols = mapRateColumns(header);
    dataRows = table.rows.slice(headerIndex + 1);
  } else if (
    table.rows.length > 0 &&
    table.rows.every((r) => r.length === 30)
  ) {
    cols = POSITIONAL_30_COLUMNS;
    dataRows = table.rows;
  } else {
    return NO_HEADER;
  }
  if (REQUIRED.some((f) => cols[f] === undefined)) return NO_HEADER;
  if (dataRows.length > 5000) return TOO_MANY;

  const vouchers: ReceivedVoucher[] = [];
  const unreadable: UnreadableVoucher[] = [];
  const skippedByReason: Partial<Record<SkipReason, number>> = {};
  const skipped: SkippedRow[] = [];
  for (const row of dataRows) {
    const result = parseRow(row, cols, rateCols);
    if (typeof result === "string") {
      skippedByReason[result] = (skippedByReason[result] ?? 0) + 1;
      const kept = isUnreadableReason(result)
        ? unreadableRow(row, cols, result)
        : null;
      if (kept) unreadable.push(kept);
      if (skipped.length < SKIPPED_ROWS_NAMED) {
        const amounts =
          result === "amount_over_total" ? amountsRef(row, cols) : "";
        skipped.push({
          reason: result,
          ref: amounts
            ? `${rowRef(row, cols)} · ${amounts}`.slice(0, 300)
            : rowRef(row, cols),
        });
      }
    } else {
      vouchers.push(result);
    }
  }
  return { vouchers, unreadable, skippedByReason, skipped };
}

/** The uploaded file (CSV in UTF-8 or windows-1252, or Excel) as vouchers, or
 *  the message for the user. */
export function parseReceivedExport(
  fileName: string,
  bytes: Uint8Array,
): ParsedReceivedExport | string {
  const table = readUploadedTable(fileName, bytes, RECEIVED_EXPORT_LIMITS, {
    decode: decodeText,
  });
  if (typeof table === "string") return table;
  return parseReceivedTable(table);
}
