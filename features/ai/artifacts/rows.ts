/** A tool result row: one object per record. */
export type DataRow = Record<string, unknown>;

export function isRecord(value: unknown): value is DataRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The rows in a tool's `data`: the array itself, or its first property that
 *  is an array of objects (e.g. `clients`, `items`, `rows`). */
export function resolveRows(data: unknown): DataRow[] | null {
  if (Array.isArray(data)) {
    const rows = data.filter(isRecord);
    return rows.length ? rows : null;
  }
  if (isRecord(data)) {
    for (const value of Object.values(data)) {
      if (Array.isArray(value)) {
        const rows = value.filter(isRecord);
        if (rows.length) return rows;
      }
    }
  }
  return null;
}

/** Field names that hold amounts of money. */
export const MONEY_KEY =
  /total|saldo|importe|imp_|amount|monto|neto|iva|debe|haber|debit|credit|balance|running|bucket|open|cost|margin|revenue|expense|paid|billed|collected/i;

const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;

/** A finite number from a number or a numeric string (Postgres `numeric`
 *  arrives as a string); null otherwise. */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && NUMERIC_STRING.test(value.trim())) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Keys that identify rows rather than describe them. */
export function isIdKey(key: string): boolean {
  return /_id$|^id$/i.test(key);
}

/** Field names in first-seen order across the rows. */
export function fieldsOf(rows: readonly DataRow[]): string[] {
  const seen = new Set<string>();
  for (const row of rows.slice(0, 50)) {
    for (const key of Object.keys(row)) seen.add(key);
  }
  return [...seen];
}

/** True when every non-empty value of `key` is numeric, and one exists. */
export function isNumericField(rows: readonly DataRow[], key: string): boolean {
  let any = false;
  for (const row of rows) {
    const value = row[key];
    if (value === null || value === undefined || value === "") continue;
    if (toNumber(value) === null) return false;
    any = true;
  }
  return any;
}

/** "client_legal_name" → "Client legal name". */
export function prettifyKey(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
