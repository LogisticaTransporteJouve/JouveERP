import {
  formatArgentineDate,
  formatArgentineDateTime,
  formatMoney,
  formatPeriod,
} from "@/lib/format";

import type { ArtifactCell, ResolvedChart, TableColumn } from "./spec";

type ValueFormat = ResolvedChart["valueFormat"];

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

/** A value in full, for tooltips and tables. */
export function formatValue(
  value: number | null,
  format: ValueFormat,
  currency = "ARS",
): string {
  if (value === null) return "—";
  if (format === "money") return formatMoney(value, currency);
  if (format === "percent") return `${numberFmt.format(value)} %`;
  return numberFmt.format(value);
}

/** A value on an axis: compact ("1,2 M"). */
export function formatAxisValue(
  value: number,
  format: ValueFormat,
  currency = "ARS",
): string {
  const n = compactFmt.format(value);
  if (format === "money") return `${currency === "USD" ? "US$" : "$"} ${n}`;
  if (format === "percent") return `${n} %`;
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
    return formatValue(value, column.money ? "money" : "number", currency);
  }
  return formatCategory(value);
}
