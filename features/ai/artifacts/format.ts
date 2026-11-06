import {
  formatArgentineDate,
  formatArgentineDateTime,
  formatInteger,
  formatMoney,
  formatPeriod,
} from "@/lib/format";

import type {
  ArtifactCell,
  ChartArtifact,
  TableColumn,
  ValueFormat,
} from "./spec";

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;

const numberFmt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const compactFmt = new Intl.NumberFormat("es-AR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** A category or period as the user reads it ("may 2026", "17 may 2026"). */
export function formatCategory(value: string): string {
  if (PLAIN_DATE.test(value)) return formatArgentineDate(value);
  if (TIMESTAMP.test(value)) return formatArgentineDateTime(value);
  return formatPeriod(value);
}

const JARGON = [
  /`/,
  /\*_/,
  /\b[a-z0-9]+_[a-z0-9_]+\b/,
  /\b[a-z]+[A-Z][A-Za-z]+\b/,
];

/** True when a caption reads as plain prose: no backticks, wildcards, row
 *  field names (snake_case) or tool names (camelCase). */
export function isPlainCaption(text: string): boolean {
  return !JARGON.some((re) => re.test(text));
}

/** A point's axis label: a document date reads "17/05"; anything else as
 *  a category. */
export function formatTick(value: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${m[2]}/${m[1]}` : formatCategory(value);
}

/**
 * The points whose axis label is drawn: at most `max`, spread evenly. When
 * the labels repeat (several documents of one day), only the first point of
 * each run is a candidate, so a date is never printed twice.
 */
export function tickIndices(labels: readonly string[], max = 10): number[] {
  const candidates = labels.flatMap((label, i) =>
    i > 0 && labels[i - 1] === label ? [] : [i],
  );
  const every = Math.ceil(candidates.length / max);
  return candidates.filter((_, i) => i % every === 0);
}

/** A chart point's label fields as its tooltip lists them, without blanks
 *  and without repeating the point's own label. */
export function pointDetails(
  artifact: ChartArtifact,
  index: number,
): { label: string; value: string }[] {
  const point = artifact.points[index];
  if (!point?.detail) return [];
  return (artifact.chart.detail ?? []).flatMap((d, i) => {
    const raw = point.detail?.[i];
    return raw && raw !== point.x
      ? [{ label: d.label, value: formatCategory(raw) }]
      : [];
  });
}

/** A value in full, for tooltips and tables. */
export function formatValue(
  value: number | null,
  format: ValueFormat,
  currency = "ARS",
): string {
  if (value === null) return "—";
  if (format === "money") return formatMoney(value, currency);
  if (format === "usd") return formatMoney(value, "USD");
  if (format === "percent") return `${numberFmt.format(value)} %`;
  if (format === "count") return formatInteger(value);
  if (format === "km") return `${formatInteger(value)} km`;
  return numberFmt.format(value);
}

/** A value on an axis: compact ("1,2 M"). */
export function formatAxisValue(
  value: number,
  format: ValueFormat,
  currency = "ARS",
): string {
  const n = compactFmt.format(value);
  if (format === "usd") return `US$ ${n}`;
  if (format === "money") return `${currency === "USD" ? "US$" : "$"} ${n}`;
  if (format === "percent") return `${n} %`;
  if (format === "km") return `${n} km`;
  return n;
}

/** A table cell as text. */
export function formatCell(
  column: TableColumn,
  value: ArtifactCell,
  currency = "ARS",
): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number") {
    return formatValue(
      value,
      column.format === "text" ? "number" : column.format,
      currency,
    );
  }
  return formatCategory(value);
}
