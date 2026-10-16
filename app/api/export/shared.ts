import "server-only";

import type { Permission } from "@/lib/auth/permissions";
import type { XlsxCell, XlsxSheet } from "@/lib/export/xlsx";
import { formatArgentineDate, formatNumber2 } from "@/lib/format";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";

export const money = (n: number) => `$${formatNumber2(n)}`;

/** A cell the PDF prints as `text` and the Excel export writes as `value`. */
export type TypedCell = { text: string; value: XlsxCell };

/** Plain text (names, codes, labels), or a typed cell. */
export type ExportCell = string | TypedCell;

/** An amount: `$1.234,56` in the PDF unless `text` says otherwise, a numeric
 *  cell in its currency in Excel. */
export function moneyCell(
  amount: number,
  { currency = "ARS", text }: { currency?: string; text?: string } = {},
): TypedCell {
  return { text: text ?? money(amount), value: { money: amount, currency } };
}

/** A `YYYY-MM-DD` date or timestamp: `5 jun 2026` in the PDF, a date cell in
 *  Excel; "—" when missing. */
export function dateCell(value: string | null | undefined): ExportCell {
  return value
    ? { text: formatArgentineDate(value), value: { date: value } }
    : "—";
}

/** A plain number (liters, km, a rate) with the PDF's text. */
export function numberCell(value: number, text: string): TypedCell {
  return { text, value };
}

export function cellText(cell: ExportCell): string {
  return typeof cell === "string" ? cell : cell.text;
}

export function cellValue(cell: ExportCell): XlsxCell {
  return typeof cell === "string" ? cell : cell.value;
}

export type ExportRange = { from: string | null; to: string | null };

export type ExportOutput = {
  title: string;
  subtitle?: string;
  columns: TableReportColumn[];
  rows: ExportCell[][];
  totalsRow?: ExportCell[];
  orientation?: "portrait" | "landscape";
  /** Base file name (without extension). */
  fileName: string;
};

export type Exporter = {
  permission: Permission;
  load: (params: URLSearchParams, range: ExportRange) => Promise<ExportOutput>;
};

/** The exporter's rows as a spreadsheet: typed cells keep their type, and a
 *  right-aligned column's numeric strings (a year, a count) become numbers;
 *  every other string stays text. */
export function exportSheet(out: ExportOutput): XlsxSheet {
  const row = (cells: readonly ExportCell[]) => cells.map(cellValue);
  return {
    name: out.title,
    columns: out.columns.map((c) => ({
      header: c.header,
      type: c.align === "right" ? "number" : "text",
    })),
    rows: out.rows.map(row),
    ...(out.totalsRow ? { totals: row(out.totalsRow) } : {}),
  };
}

/** True when `date` (YYYY-MM-DD) falls within the (optional) range bounds. */
export function inRange(date: string, range: ExportRange): boolean {
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

/** Shared column layout for current-account statements (portrait A4 ≈ 547pt). */
export const ACCOUNT_COLUMNS: TableReportColumn[] = [
  { header: "Fecha", width: 64, mono: true },
  { header: "Tipo", width: 100 },
  { header: "Documento", width: 115, mono: true },
  { header: "Debe", width: 90, align: "right", mono: true },
  { header: "Haber", width: 90, align: "right", mono: true },
  { header: "Saldo", width: 88, align: "right", mono: true },
];
