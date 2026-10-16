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

/** How a field's values read. */
export type FieldFormat =
  "code" | "percent" | "count" | "usd" | "money" | "number";

const COUNT_NOUNS =
  "clients|suppliers|documents|groups|invoices|receipts|employees|drivers|trips|vehicles|items|rows|movements|entries|records|checks|loads|shipments|pallets|products|orders|units|days|leaves|periods";

/**
 * A field's format from its name, first matching rule wins: identifiers and
 * codes (kept as text), percentages, counts, foreign-currency amounts, money,
 * then plain numbers. The order matters: `margin_pct` is a percentage,
 * `total_clients` a count and `cost_center_code` a code, though each also
 * looks like money.
 */
const FORMAT_RULES: readonly [FieldFormat, RegExp][] = [
  [
    "code",
    /(^|_)(code|codigo|number|numero|nro|cuit|cuil|cbu|dni|cae|caea|plate|patente|zip)$|^(cuit|cuil|cbu|numero|nro)(_|$)/i,
  ],
  ["percent", /(^|_)(pct|percent|percentage|porcentaje)($|_)/i],
  [
    "count",
    new RegExp(
      `(^|_)(count|qty|quantity|cantidad|days|dias)($|_)|^(total|num|n)_(${COUNT_NOUNS})$`,
      "i",
    ),
  ],
  ["usd", /(^|_)(usd|foreign|fx|dolares)($|_)/i],
  [
    "money",
    /total|saldo|importe|imp_|amount|monto|neto|iva|debe|haber|debit|credit|balance|running|bucket|open|cost|margin|revenue|expense|paid|billed|collected/i,
  ],
];

export function fieldFormat(key: string): FieldFormat {
  return FORMAT_RULES.find(([, re]) => re.test(key))?.[0] ?? "number";
}

/** Digits a spreadsheet would mangle as a number: "0012". */
const LEADING_ZERO = /^-?0\d/;
const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;

/** A finite number from a number or a numeric string (Postgres `numeric`
 *  arrives as a string); null otherwise, and for codes with leading zeros. */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!NUMERIC_STRING.test(text) || LEADING_ZERO.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Field names an artifact may carry (the spec's field-name rule). */
export function isArtifactField(key: string): boolean {
  return /^[A-Za-z0-9_]{1,64}$/.test(key);
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

/** True when every non-empty value of `key` is numeric, and one exists.
 *  Codes and identifiers never are, even when they are all digits. */
export function isNumericField(rows: readonly DataRow[], key: string): boolean {
  if (fieldFormat(key) === "code") return false;
  let any = false;
  for (const row of rows) {
    const value = row[key];
    if (value === null || value === undefined || value === "") continue;
    if (toNumber(value) === null) return false;
    any = true;
  }
  return any;
}

/** "client_legal_name" → "Client legal name", within the label limit. */
export function prettifyKey(key: string): string {
  const words = key.replace(/_/g, " ").trim().slice(0, 60);
  return words.charAt(0).toUpperCase() + words.slice(1);
}
