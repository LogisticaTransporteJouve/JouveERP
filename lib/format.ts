// Deterministic date formatters used in both server and client renders.
//
// `Intl.DateTimeFormat` produces different Unicode whitespace characters
// across Node (full ICU) and modern browsers (e.g. NBSP U+00A0 vs NARROW
// NO-BREAK SPACE U+202F before AM/PM markers). That mismatch shows up as a
// React hydration warning even though the visible strings look identical.
// Building the string by hand avoids that whole class of bugs.

const MONTHS_ES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

const AR_OFFSET_MS = 3 * 60 * 60 * 1000;

export function formatArgentineDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  // Shift to Argentina (UTC-3, no DST since 2009) and read the UTC parts.
  const ar = new Date(date.getTime() - AR_OFFSET_MS);
  const day = ar.getUTCDate();
  const month = MONTHS_ES[ar.getUTCMonth()] ?? "";
  const year = ar.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

/**
 * Format a free-form numeric input into es-AR style while typing:
 * thousands separated by dots, decimals by comma (up to 2 digits).
 * Used as `onChange={e => setValue(formatAmountInput(e.target.value))}`.
 * Paired with `parseAmount` (in receipts/components/receipt-form) which
 * reverses the dots/commas before sending to the server.
 */
/**
 * Format a number into the es-AR input string used by money fields
 * (e.g. 3865.59 → "3.865,59"). Inverse of `parseAmount` so values can
 * round-trip from DB → form → DB without losing/inflating digits.
 */
export function amountToInput(value: number): string {
  return formatAmountInput(value.toFixed(2).replace(".", ","));
}

export function formatAmountInput(raw: string): string {
  const cleaned = raw.replace(/[^\d,]/g, "");
  const parts = cleaned.split(",");
  let intPart = parts[0] ?? "";
  const decPart =
    parts.length > 1 ? parts.slice(1).join("").slice(0, 2) : null;
  if (intPart.length > 1) intPart = intPart.replace(/^0+(?=\d)/, "");
  if (intPart.length === 0 && decPart !== null) intPart = "0";
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decPart === null ? grouped : `${grouped},${decPart}`;
}

// Centralized money formatters (previously replicated across 23 files).
// Always use these helpers instead of building `Intl.NumberFormat` inline.

const moneyFmt2 = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const moneyFmt0 = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** "3.865,59" — without currency symbol. */
export function formatNumber2(value: number | string | null | undefined): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n)) return "0,00";
  return moneyFmt2.format(n);
}

/** "3.866" — integer, no decimals. */
export function formatInteger(value: number | string | null | undefined): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return moneyFmt0.format(Math.round(n));
}

/** "$ 3.865,59" — peso by default; "US$ 3.865,59" if currency === "USD". */
export function formatMoney(
  value: number | string | null | undefined,
  currency: "ARS" | "USD" | string = "ARS",
): string {
  const sign = currency === "USD" ? "US$" : "$";
  return `${sign} ${formatNumber2(value)}`;
}

/** "-$ 3.865,59" — formatMoney with sign, honoring negatives. */
export function formatMoneySigned(
  value: number | string | null | undefined,
  currency: "ARS" | "USD" | string = "ARS",
): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (n < 0) return `-${formatMoney(-n, currency)}`;
  return formatMoney(n, currency);
}

/** "ARS 3.865,59" — uses the literal code instead of the symbol. Intended for
 *  detail pages where we want to show the formal currency code rather than the
 *  symbol (`formatMoney` returns `$`/`US$`). Consolidates the `money(n, code)`
 *  helpers defined locally in receipts/[id], purchases/[id], payment-orders/[id]. */
export function formatMoneyWithCode(
  value: number | string | null | undefined,
  currencyCode: string,
): string {
  return `${currencyCode} ${formatNumber2(value)}`;
}

export function formatArgentineDateTime(
  value: string | null | undefined,
): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const ar = new Date(date.getTime() - AR_OFFSET_MS);
  const day = ar.getUTCDate();
  const month = MONTHS_ES[ar.getUTCMonth()] ?? "";
  const year = ar.getUTCFullYear();
  const hh = String(ar.getUTCHours()).padStart(2, "0");
  const mm = String(ar.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hh}:${mm}`;
}

/** "17/5/2026" — short es-AR date via `toLocaleDateString`. Used by
 *  emails and attachments where the compact format is preferred over the "17 may 2026"
 *  of `formatArgentineDate`. Accepts an ISO string or Date; invalid → "—". */
export function formatArDateShort(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-AR");
}

/** "YYYY-MM-DD" of the current day in Argentine time (UTC-3). Used as the default
 *  for the date inputs of the forms (receipts, checks, transactions, OPs). */
export function todayInAR(): string {
  const ar = new Date(Date.now() - AR_OFFSET_MS);
  return ar.toISOString().slice(0, 10);
}

/** Round to 2 decimals — used in monetary calculations (IVA, totals,
 *  exchange rates). Centralized to avoid the 4+ verbatim copies that
 *  lived in schemas, actions, inngest, and renders. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Parses an amount in es-AR format ("1.234,56" → 1234.56). Returns null
 *  if the string does not represent a finite number. It is the semantic inverse of
 *  `formatAmountInput` / `amountToInput`. */
export function parseArAmount(raw: string): number | null {
  const cleaned = raw
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".");
  if (cleaned.length === 0) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Sums es-AR amounts (string `"1.234,56"`) from a collection, extracting the
 *  string with a picker. Invalid / empty values contribute 0. Consolidates the
 *  `sumDraftAllocations` logic that was duplicated in receipt-form and
 *  payment-order-form. */
export function sumArAmountsBy<T>(
  items: readonly T[],
  pick: (item: T) => string,
): number {
  return items.reduce((acc, item) => acc + (parseArAmount(pick(item)) ?? 0), 0);
}

/** Sanitizes a string fragment to use it in a download filename
 *  (invoice PDF, receipt, etc.):
 *  - normalizes Unicode (NFKD) to avoid odd combinations
 *  - strips filesystem-reserved chars (< > : " / \ | ? * and control chars)
 *  - strips commas/semicolons (they break filenames in some mail clients)
 *  - collapses whitespace into a single space
 *  Consolidated from 3 verbatim dupes that lived in send-receipt-email,
 *  send-invoice-email, and invoices-table. */
export function safeFilenamePart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/[,;]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Builds the PDF filename for an invoice / receipt:
 *  `<numero> - <name>.pdf`, with `name` sanitized via safeFilenamePart.
 *  Consolidates the pattern duplicated in send-receipt-email, send-invoice-email,
 *  and invoices-table. */
export function buildPdfFilename(numero: string, name: string): string {
  return `${numero} - ${safeFilenamePart(name)}.pdf`;
}
