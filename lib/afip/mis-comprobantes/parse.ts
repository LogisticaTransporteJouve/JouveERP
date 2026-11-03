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
  kindLetterForCbteTipo,
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
  Record<"perc_iva" | "perc_iibb" | "municipales" | "internos", number>
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
  | "amount_mismatch";

export type ParsedReceivedExport = {
  vouchers: ReceivedVoucher[];
  skippedByReason: Partial<Record<SkipReason, number>>;
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
  "perc_iibb",
  "municipales",
  "internos",
] as const;
type Field = (typeof FIELDS)[number];

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
  neto_gravado: ["imp neto gravado", "imp neto gravado total", "neto gravado"],
  no_gravado: ["imp neto no gravado", "neto no gravado"],
  exentas: ["imp op exentas", "op exentas"],
  otros_tributos: ["otros tributos", "imp otros tributos"],
  iva: ["iva", "total iva", "imp iva"],
  total: ["imp total", "importe total", "total"],
  perc_iva: ["percepciones de iva", "percepcion iva", "perc iva"],
  perc_iibb: [
    "percepciones de ingresos brutos",
    "percepcion iibb",
    "perc iibb",
  ],
  municipales: ["impuestos municipales", "imp municipales"],
  internos: ["impuestos internos", "imp internos"],
};

// The 30-column TSV the old importer read (scripts/import-afip-purchases.mjs).
const LEGACY_POSITIONS: Readonly<Partial<Record<Field, number>>> = {
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

/** Per-rate columns ("Imp. Neto Gravado IVA 21%", "IVA 21%"), by AFIP rate. */
function mapRateColumns(
  header: readonly string[],
): Map<IvaRateId, { neto?: number; iva?: number }> {
  const out = new Map<IvaRateId, { neto?: number; iva?: number }>();
  header.map(normalizeHeader).forEach((h, i) => {
    const m = /^(?:(imp neto gravado|neto gravado) )?iva (\d+(?: \d+)?)$/.exec(
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

const near = (a: number, b: number) => Math.abs(a - b) <= 0.01;

function parseRow(
  row: readonly string[],
  cols: Partial<Record<Field, number>>,
  rateCols: Map<IvaRateId, { neto?: number; iva?: number }>,
): ReceivedVoucher | SkipReason {
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
  const moneda = parseMoneda(cell("moneda"));
  if (moneda === null) return "bad_amount";

  const amounts = {
    neto: parseAmount(row, cols.neto_gravado),
    noGravado: parseAmount(row, cols.no_gravado),
    exentas: parseAmount(row, cols.exentas),
    trib: parseAmount(row, cols.otros_tributos),
    iva: parseAmount(row, cols.iva),
    total: parseAmount(row, cols.total),
  };
  if (Object.values(amounts).some((v) => v === null)) return "bad_amount";
  const { neto, noGravado, exentas, trib, iva, total } = amounts as Record<
    keyof typeof amounts,
    number
  >;

  const tribBreakdown: TribBreakdown = {};
  for (const [field, key] of [
    ["perc_iva", "perc_iva"],
    ["perc_iibb", "perc_iibb"],
    ["municipales", "municipales"],
    ["internos", "internos"],
  ] as const) {
    if (cols[field] === undefined) continue;
    const v = parseAmount(row, cols[field]);
    if (v === null) return "bad_amount";
    tribBreakdown[key] = v;
  }

  const ivaBreakdown: IvaBreakdownLine[] = [];
  for (const [rate, c] of rateCols) {
    const n = parseAmount(row, c.neto);
    const v = parseAmount(row, c.iva);
    if (n === null || v === null) return "bad_amount";
    if (n !== 0 || v !== 0)
      ivaBreakdown.push({ iva_rate_id: rate, neto: n, iva: v });
  }

  if (!near(round2(neto + noGravado + exentas + iva + trib), total)) {
    return "amount_mismatch";
  }
  if (ivaBreakdown.length > 0) {
    const sumNeto = round2(ivaBreakdown.reduce((a, l) => a + l.neto, 0));
    const sumIva = round2(ivaBreakdown.reduce((a, l) => a + l.iva, 0));
    if (!near(sumNeto, neto) || !near(sumIva, iva)) return "amount_mismatch";
  }
  const tribParts = Object.values(tribBreakdown);
  if (
    tribParts.length > 0 &&
    !near(round2(tribParts.reduce((a, v) => a + v, 0)), trib)
  ) {
    return "amount_mismatch";
  }

  const cotizacionRaw = cell("tipo_cambio");
  const cotizacion =
    moneda === "DOL" && cotizacionRaw !== ""
      ? parseStatementNumber(cotizacionRaw)
      : null;

  const kl = kindLetterForCbteTipo(cbteTipo);
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
    imp_neto_gravado: neto,
    imp_no_gravado: noGravado,
    imp_op_exentas: exentas,
    imp_iva: iva,
    imp_trib: trib,
    imp_total: total,
    trib_breakdown: tribBreakdown,
    iva_breakdown: ivaBreakdown,
  };
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
    cols = LEGACY_POSITIONS;
    dataRows = table.rows;
  } else {
    return NO_HEADER;
  }
  if (REQUIRED.some((f) => cols[f] === undefined)) return NO_HEADER;
  if (dataRows.length > 5000) return TOO_MANY;

  const vouchers: ReceivedVoucher[] = [];
  const skippedByReason: Partial<Record<SkipReason, number>> = {};
  for (const row of dataRows) {
    const result = parseRow(row, cols, rateCols);
    if (typeof result === "string") {
      skippedByReason[result] = (skippedByReason[result] ?? 0) + 1;
    } else {
      vouchers.push(result);
    }
  }
  return { vouchers, skippedByReason };
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
