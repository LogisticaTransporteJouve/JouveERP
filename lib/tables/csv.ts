export type ParsedTable = { rows: string[][]; truncated: boolean };

/** How much of a table a reader keeps: rows, columns and characters per cell. */
export type TableLimits = {
  readonly rows: number;
  readonly columns: number;
  readonly cellChars: number;
};

/** `;` is the default list separator in Spanish-locale Excel exports. Read
 *  over the first lines, so a title line above the header does not decide. */
function detectDelimiter(text: string): string {
  // The separator of the table, not of a preamble: the one that splits the
  // most of the first lines into 3+ fields (a bank statement starts with a
  // few tab-separated header lines), then the most frequent.
  const lines = text.split(/\r?\n/, 40);
  const counts = [",", ";", "\t"].map((d) => ({
    d,
    lines: lines.filter((l) => l.split(d).length >= 3).length,
    n: lines.slice(0, 5).join("\n").split(d).length - 1,
  }));
  counts.sort((a, b) => b.lines - a.lines || b.n - a.n);
  return counts[0] && (counts[0].lines > 0 || counts[0].n > 0)
    ? counts[0].d
    : ",";
}

/** Trims a table to `limits` and drops empty rows. */
export function capTable(
  rows: string[][],
  limits: TableLimits,
  alreadyTruncated = false,
): ParsedTable {
  const { rows: maxRows, columns, cellChars } = limits;
  let truncated = alreadyTruncated;
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length > maxRows) truncated = true;
  const out = nonEmpty.slice(0, maxRows).map((row) => {
    if (row.length > columns) truncated = true;
    return row.slice(0, columns).map((cell) => {
      const value = cell.trim();
      if (value.length <= cellChars) return value;
      truncated = true;
      return `${value.slice(0, cellChars)}…`;
    });
  });
  return { rows: out, truncated };
}

/**
 * RFC 4180 CSV (quoted fields, doubled quotes, CRLF or LF). Stops reading
 * past the row cap so a huge file costs no more than the rows kept.
 */
export const CSV_DELIMITERS = [",", ";", "\t"] as const;

export function parseCsv(
  input: string,
  limits: TableLimits,
  /** Forces the separator; by default it is detected. */
  forced?: (typeof CSV_DELIMITERS)[number],
): ParsedTable {
  const text = input.replace(/^﻿/, "");
  const delimiter = forced ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let stoppedEarly = false;
  const maxRows = limits.rows + 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (rows.length >= maxRows) {
        stoppedEarly = i < text.length - 1;
        break;
      }
    } else {
      field += ch;
    }
  }
  if (!stoppedEarly && (field !== "" || row.length > 0)) {
    row.push(field);
    rows.push(row);
  }
  return capTable(rows, limits, stoppedEarly);
}
