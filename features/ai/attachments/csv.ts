import { CHAT_TABLE_LIMITS } from "./limits";

export type ParsedTable = { rows: string[][]; truncated: boolean };

/** `;` is the default list separator in Spanish-locale Excel exports. */
function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const counts = [",", ";", "\t"].map((d) => ({
    d,
    n: firstLine.split(d).length - 1,
  }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0] && counts[0].n > 0 ? counts[0].d : ",";
}

/** Trims a table to CHAT_TABLE_LIMITS and drops empty trailing rows. */
export function capTable(
  rows: string[][],
  alreadyTruncated = false,
): ParsedTable {
  const { rows: maxRows, columns, cellChars } = CHAT_TABLE_LIMITS;
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
export function parseCsv(input: string): ParsedTable {
  const text = input.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let stoppedEarly = false;
  const maxRows = CHAT_TABLE_LIMITS.rows + 1;

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
  return capTable(rows, stoppedEarly);
}
