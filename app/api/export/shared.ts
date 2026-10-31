import "server-only";

import { z } from "zod";

import { AGING_BUCKETS, type AgingBucket, type AgingReport } from "@/lib/aging";
import type { Permission } from "@/lib/auth/permissions";
import { exportSlug } from "@/lib/export/download";
import type { XlsxCell, XlsxSheet } from "@/lib/export/xlsx";
import { formatArgentineDate, formatNumber2 } from "@/lib/format";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import {
  FISCAL_FILTERS,
  isFiscalFor,
  SCOPE_LABEL,
  type FiscalFilter,
} from "@/lib/scope";

export const money = (n: number) => `$${formatNumber2(n)}`;

/** A bad query param: the route answers 400 with this message. */
export class ExportInputError extends Error {}

const ScopeParam = z.enum(FISCAL_FILTERS).default("all");

/** The header scope the export button sent (`scope=`); missing → "all". */
export function exportScope(params: URLSearchParams): {
  scope: FiscalFilter;
  isFiscal: boolean | null;
} {
  const parsed = ScopeParam.safeParse(params.get("scope") ?? undefined);
  if (!parsed.success) throw new ExportInputError("Alcance inválido.");
  return { scope: parsed.data, isFiscal: isFiscalFor(parsed.data) };
}

/** The scope label, plus the exporter's own subtitle when it has one. */
export function scopedSubtitle(scope: FiscalFilter, subtitle?: string): string {
  return subtitle ? `${SCOPE_LABEL[scope]} · ${subtitle}` : SCOPE_LABEL[scope];
}

/** The "Canal" cell: the channel's name, or "sin canal". */
export function channelCell(
  channel: { name: string } | null | undefined,
): string {
  return channel?.name ?? "sin canal";
}

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

/** A total over rows in `currencies`: an amount when they share one, and
 *  only the PDF's text when they mix (a sum across currencies is no amount
 *  in either). */
export function totalCell(
  amount: number,
  currencies: ReadonlySet<string>,
  text = money(amount),
): ExportCell {
  const [only] = currencies;
  return currencies.size <= 1
    ? moneyCell(amount, { currency: only ?? "ARS", text })
    : text;
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
  permission: Permission | readonly Permission[];
  load: (params: URLSearchParams, range: ExportRange) => Promise<ExportOutput>;
};

/** `base`, plus a slug of `detail` (an entity or channel name) when any. */
export function withSlug(base: string, detail: string | null | undefined) {
  const slug = detail ? exportSlug(detail) : "";
  return slug ? `${base}-${slug}` : base;
}

/** What the PDF prints above its table. */
export type ExportContext = { dateRangeLabel: string; generatedAt: string };

/** The exporter's rows as a spreadsheet, under the PDF's header lines: typed
 *  cells keep their type, and a right-aligned column's numeric strings (a
 *  year, a count) become numbers; every other string stays text. */
export function exportSheet(
  out: ExportOutput,
  context: ExportContext,
): XlsxSheet {
  const row = (cells: readonly ExportCell[]) => cells.map(cellValue);
  return {
    name: out.title,
    preamble: [
      out.title,
      ...(out.subtitle ? [out.subtitle] : []),
      `Período: ${context.dateRangeLabel}`,
      `Generado el ${context.generatedAt}`,
    ],
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
  { header: "Fecha", width: 60, mono: true },
  { header: "Tipo", width: 92 },
  { header: "Documento", width: 105, mono: true },
  { header: "Moneda", width: 40 },
  { header: "Debe", width: 86, align: "right", mono: true },
  { header: "Haber", width: 86, align: "right", mono: true },
  { header: "Saldo", width: 78, align: "right", mono: true },
];

type StatementCurrency = "ARS" | "USD";

export type StatementLine = {
  date: string;
  type: string;
  document: string;
  currency: StatementCurrency;
  debe: number;
  haber: number;
  /** Running balance of `currency`, or null under a scope. */
  balance: number | null;
};

/**
 * Body and totals of a current-account statement (ACCOUNT_COLUMNS). Pesos and
 * dollars never sum: each amount is typed in its row's currency, and each
 * currency gets its own totals (Σ debe, Σ haber, final balance: the last
 * listed balance of that currency, else `balances`, the action's figure).
 * With one currency the totals are the totals row; with both, two rows of
 * their own.
 */
export function accountStatementTable(
  lines: readonly StatementLine[],
  balances: Record<StatementCurrency, number>,
): { rows: ExportCell[][]; totalsRow?: ExportCell[] } {
  const amount = (n: number, currency: StatementCurrency) =>
    moneyCell(n, {
      currency,
      text: currency === "USD" ? usdMoney(n) : money(n),
    });
  const rows: ExportCell[][] = lines.map((l) => [
    dateCell(l.date),
    l.type,
    l.document,
    l.currency,
    l.debe ? amount(l.debe, l.currency) : "",
    l.haber ? amount(l.haber, l.currency) : "",
    l.balance === null ? "" : amount(l.balance, l.currency),
  ]);
  const present = new Set(lines.map((l) => l.currency));
  if (balances.USD !== 0) present.add("USD");
  const currencies: StatementCurrency[] = present.has("USD")
    ? present.has("ARS") || balances.ARS !== 0
      ? ["ARS", "USD"]
      : ["USD"]
    : ["ARS"];
  const totalsFor = (currency: StatementCurrency, label: string) => {
    const own = lines.filter((l) => l.currency === currency);
    const last = own.at(-1)?.balance;
    return [
      "",
      "",
      label,
      currency,
      amount(
        own.reduce((s, l) => s + l.debe, 0),
        currency,
      ),
      amount(
        own.reduce((s, l) => s + l.haber, 0),
        currency,
      ),
      amount(last ?? balances[currency], currency),
    ];
  };
  const [only] = currencies;
  if (currencies.length === 1 && only) {
    return { rows, totalsRow: totalsFor(only, "Totales") };
  }
  rows.push(
    totalsFor("ARS", "Totales en pesos"),
    totalsFor("USD", "Totales en dólares"),
  );
  return { rows };
}

const AGING_BUCKET_HEADERS: Record<AgingBucket, string> = {
  "0_30": "0–30 días",
  "30_60": "30–60",
  "60_90": "60–90",
  "90_plus": "90+",
};

const usdMoney = (n: number) => `US$${formatNumber2(n)}`;

/**
 * Landscape aging report (clients or suppliers). Pesos and dollars are never
 * summed: a party with balances in both currencies gets one row per currency,
 * each amount typed in its own currency. "Total en ARS" is the party's
 * exposure with dollars at the latest official rate ("—" without a rate).
 * With dollars present, the per-currency totals are rows of their own and the
 * totals row carries only the peso equivalent.
 */
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
  const amount = (n: number, currency: "ARS" | "USD") =>
    moneyCell(n, {
      currency,
      text: currency === "USD" ? usdMoney(n) : money(n),
    });
  const equivalent = (n: number | null): ExportCell =>
    n === null ? "—" : moneyCell(n);
  const rateNote = usd_rate
    ? `USD al dólar oficial ${money(usd_rate.rate)} (${formatArgentineDate(usd_rate.rate_date)})`
    : "Sin cotización del dólar cargada: los saldos en USD no se consolidan";

  const out: ExportCell[][] = [];
  for (const r of rows) {
    const currencies: ("ARS" | "USD")[] =
      r.total.usd !== 0 && r.total.ars !== 0
        ? ["ARS", "USD"]
        : r.total.usd !== 0
          ? ["USD"]
          : ["ARS"];
    currencies.forEach((currency, i) => {
      const key = currency === "ARS" ? "ars" : "usd";
      out.push([
        r.legal_name,
        r.cuit,
        currency,
        ...AGING_BUCKETS.map((b) => amount(r.buckets[b][key], currency)),
        amount(r.total[key], currency),
        i === 0 ? equivalent(r.total_ars_equivalent) : "",
      ]);
    });
  }

  const hasUsd = totals.total.usd !== 0;
  const totalsFor = (currency: "ARS" | "USD", label: string) => {
    const key = currency === "ARS" ? "ars" : "usd";
    return [
      label,
      "",
      currency,
      ...AGING_BUCKETS.map((b) => amount(totals.buckets[b][key], currency)),
      amount(totals.total[key], currency),
    ];
  };
  if (hasUsd) {
    out.push(
      [...totalsFor("ARS", "Totales en pesos"), ""],
      [...totalsFor("USD", "Totales en dólares"), ""],
    );
  }

  return {
    title: meta.title,
    subtitle: `${meta.subtitle} · ${rateNote}`,
    columns: [
      { header: meta.partyHeader, width: 200 },
      { header: "CUIT", width: 90, mono: true },
      { header: "Moneda", width: 44 },
      ...AGING_BUCKETS.map((b): TableReportColumn => ({
        header: AGING_BUCKET_HEADERS[b],
        width: 78,
        align: "right",
        mono: true,
      })),
      { header: "Total", width: 74, align: "right", mono: true },
      { header: "Total en ARS", width: 74, align: "right", mono: true },
    ],
    rows: out,
    totalsRow: hasUsd
      ? [
          "Total en pesos",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          equivalent(totals.total_ars_equivalent),
        ]
      : [
          ...totalsFor("ARS", "Totales"),
          equivalent(totals.total_ars_equivalent),
        ],
    orientation: "landscape",
    fileName: meta.fileName,
  };
}
