/** A cell a CSV export accepts; anything else is written empty. */
export type CsvCell = string | number | boolean | null | undefined;

/** Leading characters a spreadsheet reads as the start of a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * One CSV field. Text that a spreadsheet would run as a formula (CSV
 * injection) gets a leading apostrophe; plain numbers stay numbers, so a
 * negative amount is not mangled.
 */
export function csvField(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  const text =
    FORMULA_START.test(value) && !PLAIN_NUMBER.test(value)
      ? `'${value}`
      : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV with a header row and CRLF line ends. */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly CsvCell[])[],
): string {
  return [header, ...rows]
    .map((row) => row.map(csvField).join(","))
    .join("\r\n");
}

/** Saves `csv` in the browser. The BOM makes Excel read it as UTF-8. */
export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** A file name from a title: lowercase ASCII words joined by dashes. */
export function csvFileName(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "export"}.csv`;
}
