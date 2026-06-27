import "server-only";

import type { Permission } from "@/lib/auth/permissions";
import { formatNumber2 } from "@/lib/format";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";

export const money = (n: number) => `$${formatNumber2(n)}`;

export type ExportRange = { from: string | null; to: string | null };

export type ExportOutput = {
  title: string;
  subtitle?: string;
  columns: TableReportColumn[];
  rows: string[][];
  totalsRow?: string[];
  orientation?: "portrait" | "landscape";
  /** Base file name (without extension). */
  fileName: string;
};

export type Exporter = {
  permission: Permission;
  load: (params: URLSearchParams, range: ExportRange) => Promise<ExportOutput>;
};

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
