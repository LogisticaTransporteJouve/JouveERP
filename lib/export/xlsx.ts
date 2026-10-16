import writeXlsxFile, {
  type CellObject,
  type SheetData,
} from "write-excel-file/universal";

import { AR_OFFSET_MS, formatNumber2 } from "@/lib/format";

/** How a column's plain values are written. Typed cells (`{ money }`,
 *  `{ date }`) are written as such in any column. */
export type XlsxColumnType =
  "text" | "number" | "integer" | "money" | "percent" | "date";

export type XlsxColumn = {
  header: string;
  type?: XlsxColumnType;
  /** Currency of a money column's plain numbers (default ARS). */
  currency?: string;
};

export type XlsxCell =
  | string
  | number
  | boolean
  | null
  | undefined
  | { money: number; currency: string }
  /** `YYYY-MM-DD`, or an ISO timestamp (written in Argentina's time). */
  | { date: string };

export type XlsxSheet = {
  name: string;
  columns: readonly XlsxColumn[];
  rows: readonly (readonly XlsxCell[])[];
  /** A bold last row, aligned with `columns`. */
  totals?: readonly XlsxCell[];
  /** Context lines above the table (title first, in bold): what the PDF
   *  prints in its header. */
  preamble?: readonly string[];
};

export { XLSX_MIME } from "./mime";

const FORMAT = {
  money: "#,##0.00",
  integer: "#,##0",
  percent: '#,##0.00" %"',
  date: "dd/mm/yyyy",
  dateTime: "dd/mm/yyyy hh:mm",
};

const BOLD: Pick<CellObject, "fontWeight"> = { fontWeight: "bold" };

const SYMBOL: Record<string, string> = { ARS: "$", USD: "US$" };

const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;
/** Digits a spreadsheet would mangle as a number: "0012". */
const LEADING_ZERO = /^-?0\d/;
const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;
const SHEET_NAME_FORBIDDEN = /[[\]:*?/\\]/g;
/** Excel's cell text limit. */
const MAX_TEXT = 32_767;
/** What an empty cell reads as in the app's tables. */
const EMPTY_MARK = "—";

const MIN_WIDTH = 8;
const MAX_WIDTH = 60;

/** Drops what XML 1.0 cannot carry: control characters, U+FFFE/U+FFFF and
 *  lone surrogates. */
function cleanText(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      continue;
    }
    if (code === 0xfffe || code === 0xffff) continue;
    // A paired surrogate iterates as one two-unit character.
    if (ch.length === 1 && code >= 0xd800 && code <= 0xdfff) continue;
    out += ch;
  }
  return out.slice(0, MAX_TEXT);
}

/** A worksheet name Excel accepts: at most 31 characters, none of
 *  `[]:*?/\`, no apostrophe at either end, not blank or "History". */
export function xlsxSheetName(raw: string): string {
  const strip = (s: string) =>
    s
      .trim()
      .replace(/^'+|'+$/g, "")
      .trim();
  const name = strip(
    strip(
      cleanText(raw).replace(SHEET_NAME_FORBIDDEN, " ").replace(/\s+/g, " "),
    ).slice(0, 31),
  );
  return name && name.toLowerCase() !== "history" ? name : "Hoja 1";
}

function toDate(value: string): { date: Date; withTime: boolean } | null {
  const plain = PLAIN_DATE.exec(value);
  if (plain) {
    const [y, m, d] = [Number(plain[1]), Number(plain[2]), Number(plain[3])];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCDate() === d && date.getUTCMonth() === m - 1
      ? { date, withTime: false }
      : null;
  }
  if (!TIMESTAMP.test(value)) return null;
  const time = Date.parse(value);
  // Excel has no time zones: write the wall clock in Argentina.
  return Number.isNaN(time)
    ? null
    : { date: new Date(time - AR_OFFSET_MS), withTime: true };
}

function moneyFormat(currency: string, headerCurrency: string | null): string {
  if (currency === headerCurrency) return FORMAT.money;
  const symbol = SYMBOL[currency] ?? currency;
  return `"${symbol} "${FORMAT.money}`;
}

function numberFormat(type: XlsxColumnType | undefined): string | undefined {
  if (type === "money") return FORMAT.money;
  if (type === "integer") return FORMAT.integer;
  if (type === "percent") return FORMAT.percent;
  return undefined;
}

type Written = { cell: CellObject | null; width: number };

function textCell(value: string): Written {
  const text = cleanText(value);
  // Always `String`: a value starting with = + - @ stays text, never a formula.
  return { cell: { type: String, value: text }, width: text.length };
}

function numberCell(value: number, format: string | undefined): Written {
  if (!Number.isFinite(value)) return { cell: null, width: 0 };
  return {
    cell: format ? { type: Number, value, format } : { type: Number, value },
    width: formatNumber2(value).length,
  };
}

function dateCell(value: string): Written {
  const parsed = toDate(value);
  if (!parsed) return textCell(value);
  return {
    cell: {
      type: Date,
      value: parsed.date,
      format: parsed.withTime ? FORMAT.dateTime : FORMAT.date,
    },
    width: parsed.withTime ? 16 : 10,
  };
}

function writeCell(
  value: XlsxCell,
  column: XlsxColumn | undefined,
  headerCurrency: string | null,
): Written {
  if (value === null || value === undefined) return { cell: null, width: 0 };
  if (typeof value === "boolean") return textCell(value ? "Sí" : "No");
  if (typeof value === "object") {
    if ("date" in value) return dateCell(value.date);
    const written = numberCell(
      value.money,
      moneyFormat(value.currency, headerCurrency),
    );
    const symbol = SYMBOL[value.currency] ?? value.currency;
    return value.currency === headerCurrency
      ? written
      : { ...written, width: written.width + symbol.length + 1 };
  }
  const type = column?.type ?? "text";
  if (typeof value === "number") {
    return type === "text" || type === "date"
      ? textCell(String(value))
      : numberCell(value, numberFormat(type));
  }
  const text = value.trim();
  if (text === "" || text === EMPTY_MARK) return { cell: null, width: 0 };
  if (type === "date") return dateCell(text);
  if (
    type !== "text" &&
    NUMERIC_STRING.test(text) &&
    !LEADING_ZERO.test(text)
  ) {
    return numberCell(Number(text), numberFormat(type));
  }
  return textCell(value);
}

/** The one currency a column's money is in, or null when it mixes them. */
function columnCurrency(
  sheet: XlsxSheet,
  index: number,
  column: XlsxColumn,
): string | null {
  const found = new Set<string>();
  if (column.type === "money") found.add(column.currency ?? "ARS");
  for (const row of [...sheet.rows, sheet.totals ?? []]) {
    const value = row[index];
    if (value && typeof value === "object" && "money" in value) {
      found.add(value.currency);
    }
  }
  const [only] = found;
  return found.size === 1 && only ? only : null;
}

function headerLabel(column: XlsxColumn, currency: string | null): string {
  const header = cleanText(column.header);
  if (currency && !header.includes(currency)) return `${header} (${currency})`;
  if (column.type === "percent" && !header.includes("%")) {
    return `${header} (%)`;
  }
  return header;
}

/**
 * The sheet as the writer's cells: a bold header row, numbers and money as
 * numeric cells (money `#,##0.00`, its currency in the header, or in the
 * cell's format when a column mixes currencies), dates as date cells, and
 * every other string as text, so codes keep their leading zeros and nothing
 * is read as a formula. Widths approximate the longest value.
 */
export function xlsxSheetData(sheet: XlsxSheet): {
  data: SheetData;
  widths: number[];
  /** Rows above and including the header, to freeze. */
  frozenRows: number;
} {
  const currencies = sheet.columns.map((c, i) => columnCurrency(sheet, i, c));
  const headers = sheet.columns.map((c, i) =>
    headerLabel(c, currencies[i] ?? null),
  );
  const widths = headers.map((h) => h.length);

  const writeRow = (row: readonly XlsxCell[], bold: boolean) =>
    sheet.columns.map((column, i) => {
      const { cell, width } = writeCell(row[i], column, currencies[i] ?? null);
      widths[i] = Math.max(widths[i] ?? 0, width);
      return cell && bold ? { ...cell, ...BOLD } : cell;
    });

  const preamble: SheetData = (sheet.preamble ?? []).map((line, i) => [
    i === 0
      ? { type: String, value: cleanText(line), ...BOLD }
      : { type: String, value: cleanText(line) },
  ]);
  if (preamble.length > 0) preamble.push([null]);

  const data: SheetData = [
    ...preamble,
    headers.map((value) => ({ type: String, value, ...BOLD })),
    ...sheet.rows.map((row) => writeRow(row, false)),
    ...(sheet.totals ? [writeRow(sheet.totals, true)] : []),
  ];

  return {
    data,
    widths: widths.map((w) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w + 2))),
    frozenRows: preamble.length + 1,
  };
}

/** The sheet as an `.xlsx` file, frozen below the header row. */
export async function buildXlsx(sheet: XlsxSheet): Promise<Blob> {
  const { data, widths, frozenRows } = xlsxSheetData(sheet);
  return writeXlsxFile(data, {
    sheet: xlsxSheetName(sheet.name),
    stickyRowsCount: frozenRows,
    columns: widths.map((width) => ({ width })),
  }).toBlob();
}
