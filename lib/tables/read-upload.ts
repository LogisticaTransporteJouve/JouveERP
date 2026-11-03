import "server-only";

import { parseCsv, type ParsedTable, type TableLimits } from "./csv";
import { XlsxReadError, readXlsxFirstSheet } from "./xlsx";

/** Server actions take the request body whole; Vercel caps it at 4.5 MB. */
export const MAX_UPLOAD_TABLE_BYTES = 4 * 1024 * 1024;

/** An uploaded .xlsx (first sheet) or .csv as a text table, or the message
 *  for the user when it cannot be read. */
export function readUploadedTable(
  fileName: string,
  bytes: Uint8Array,
  limits: TableLimits,
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
      return parseCsv(new TextDecoder("utf-8").decode(bytes), limits);
    }
  } catch (err) {
    if (err instanceof XlsxReadError) return "No se pudo leer el Excel.";
    throw err;
  }
  return "Subí el archivo en .xlsx o .csv.";
}
