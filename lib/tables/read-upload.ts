import "server-only";

import { findHeaderRowIndex, suggestColumnMapping } from "./columns";
import {
  CSV_DELIMITERS,
  parseCsv,
  type ParsedTable,
  type TableLimits,
} from "./csv";
import { XlsxReadError, readXlsxFirstSheet } from "./xlsx";

/** UTF-8 when the bytes are valid UTF-8, else windows-1252 (what ARCA and a
 *  Spanish-locale Excel write a CSV in). */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** An uploaded .xlsx (first sheet) or .csv as a text table, or the message
 *  for the user when it cannot be read. A CSV is read as UTF-8 unless
 *  `decode` says otherwise. */
export function readUploadedTable(
  fileName: string,
  bytes: Uint8Array,
  limits: TableLimits,
  opts?: {
    decode?: (bytes: Uint8Array) => string;
    /** The columns expected: a CSV is read with the separator whose header
     *  row recognizes the most of them (a bank's text export can open with
     *  a tab-separated preamble above a comma-separated table). */
    header?: {
      fields: readonly string[];
      aliases: Readonly<Record<string, readonly string[]>>;
    };
  },
): ParsedTable | string {
  const name = fileName.toLowerCase();
  if (name.endsWith(".xls")) {
    return "El formato .xls no se puede leer: guardalo como .xlsx o .csv.";
  }
  try {
    if (name.endsWith(".xlsx")) {
      return readXlsxFirstSheet(bytes, limits);
    }
    if (name.endsWith(".csv") || name.endsWith(".txt")) {
      const decode =
        opts?.decode ?? ((b: Uint8Array) => new TextDecoder("utf-8").decode(b));
      const text = decode(bytes);
      const header = opts?.header;
      if (!header) return parseCsv(text, limits);
      const recognized = (table: ParsedTable) => {
        const i = findHeaderRowIndex(table.rows, header.fields, header.aliases);
        return i < 0
          ? 0
          : Object.keys(
              suggestColumnMapping(
                table.rows[i] ?? [],
                header.fields,
                header.aliases,
              ),
            ).length;
      };
      let best = parseCsv(text, limits);
      let bestScore = recognized(best);
      for (const d of CSV_DELIMITERS) {
        const table = parseCsv(text, limits, d);
        const score = recognized(table);
        if (score > bestScore) {
          best = table;
          bestScore = score;
        }
      }
      return best;
    }
  } catch (err) {
    if (err instanceof XlsxReadError) return "No se pudo leer el Excel.";
    throw err;
  }
  return "Subí el archivo en .xlsx o .csv.";
}
