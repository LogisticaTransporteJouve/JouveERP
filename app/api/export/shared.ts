import "server-only";

import {
  AGING_BUCKETS,
  type AgingBucket,
  type AgingReport,
  type CurrencyAmounts,
} from "@/lib/aging";
import type { Permission } from "@/lib/auth/permissions";
import { formatArgentineDate, formatNumber2 } from "@/lib/format";
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

const usdMoney = (n: number) => `US$${formatNumber2(n)}`;

/** Pesos and dollars on separate lines; dollars only when non-zero. */
function amountsCell(a: CurrencyAmounts): string {
  return a.usd !== 0 ? `${money(a.ars)}\n${usdMoney(a.usd)}` : money(a.ars);
}

/** Landscape aging report (clients or suppliers): buckets per currency, the
 *  total per currency and its ARS equivalent at the latest official rate. */
export function agingExport(
  report: AgingReport,
  meta: {
    title: string;
    subtitle: string;
    partyHeader: string;
    fileName: string;
  },
): ExportOutput {
  const { rows, totals, usd_rate } = report;
  const equivalent = (n: number | null) => (n === null ? "—" : money(n));
  const rateNote = usd_rate
    ? `USD al dólar oficial ${money(usd_rate.rate)} (${formatArgentineDate(usd_rate.rate_date)})`
    : "Sin cotización del dólar cargada: los saldos en USD no se consolidan";
  return {
    title: meta.title,
    subtitle: `${meta.subtitle} · ${rateNote}`,
    columns: [
      { header: meta.partyHeader, width: 180 },
      { header: "CUIT", width: 84, mono: true },
      ...AGING_BUCKETS.map((b): TableReportColumn => ({
        header: AGING_BUCKET_HEADERS[b],
        width: 82,
        align: "right",
        mono: true,
      })),
      { header: "Total", width: 101, align: "right", mono: true },
      { header: "Total en ARS", width: 101, align: "right", mono: true },
    ],
    rows: rows.map((r) => [
      r.legal_name,
      r.cuit,
      ...AGING_BUCKETS.map((b) => amountsCell(r.buckets[b])),
      amountsCell(r.total),
      equivalent(r.total_ars_equivalent),
    ]),
    totalsRow: [
      "Totales",
      "",
      ...AGING_BUCKETS.map((b) => amountsCell(totals.buckets[b])),
      amountsCell(totals.total),
      equivalent(totals.total_ars_equivalent),
    ],
    orientation: "landscape",
    fileName: meta.fileName,
  };
}

const AGING_BUCKET_HEADERS: Record<AgingBucket, string> = {
  "0_30": "0–30 días",
  "30_60": "30–60",
  "60_90": "60–90",
  "90_plus": "90+",
};
