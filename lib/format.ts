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

/** Argentina is UTC-3 all year (no DST since 2009): local = UTC − this. */
export const AR_OFFSET_MS = 3 * 60 * 60 * 1000;

type CalendarDay = { year: number; monthIndex: number; day: number };

const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar day of `value` as seen in Argentina, or null if unparseable.
 *  A plain "yyyy-mm-dd" (a Postgres `date`) has no time or zone: it IS the
 *  calendar day, so it is read as-is. Shifting it like a timestamp (JS parses
 *  it as 00:00 UTC) would render the previous day. Timestamps are shifted to
 *  Argentina (UTC-3, no DST since 2009). */
function arCalendarDay(value: string | Date): CalendarDay | null {
  if (typeof value === "string") {
    const plain = PLAIN_DATE.exec(value);
    if (plain) {
      const year = Number(plain[1]);
      const monthIndex = Number(plain[2]) - 1;
      const day = Number(plain[3]);
      const check = new Date(Date.UTC(year, monthIndex, day));
      if (
        check.getUTCFullYear() !== year ||
        check.getUTCMonth() !== monthIndex ||
        check.getUTCDate() !== day
      ) {
        return null;
      }
      return { year, monthIndex, day };
    }
  }
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  const ar = new Date(date.getTime() - AR_OFFSET_MS);
  return {
    year: ar.getUTCFullYear(),
    monthIndex: ar.getUTCMonth(),
    day: ar.getUTCDate(),
  };
}

export function formatArgentineDate(value: string | null | undefined): string {
  if (!value) return "—";
  const cal = arCalendarDay(value);
  if (!cal) return "—";
  return `${cal.day} ${MONTHS_ES[cal.monthIndex] ?? ""} ${cal.year}`;
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
export function amountToInput(value: number, decimals = 2): string {
  const fixed = value.toFixed(decimals);
  // Beyond 2 decimals (a rate), trailing zeros are noise: 1180.500000 → 1180,50.
  const trimmed =
    decimals > 2 ? fixed.replace(/(\.\d{2}\d*?)0+$/, "$1") : fixed;
  return formatAmountInput(trimmed.replace(".", ","), decimals);
}

export function formatAmountInput(raw: string, decimals = 2): string {
  const cleaned = raw.replace(/[^\d,]/g, "");
  const parts = cleaned.split(",");
  let intPart = parts[0] ?? "";
  const decPart =
    parts.length > 1 ? parts.slice(1).join("").slice(0, decimals) : null;
  if (intPart.length > 1) intPart = intPart.replace(/^0+(?=\d)/, "");
  if (intPart.length === 0 && decPart !== null) intPart = "0";
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decPart === null ? grouped : `${grouped},${decPart}`;
}

/** Decimals of a document's cotización (`numeric(10, 4)` on invoices,
 *  purchases, receipts and payment orders), for its `MoneyInput` and its
 *  prefill: `amountToInput(rate, COTIZACION_DECIMALS)`. */
export const COTIZACION_DECIMALS = 4;

/** `formatAmountInput` that keeps a leading minus ("-1500,5" → "-1.500,5"),
 *  for amounts that can be negative, such as an account balance. */
export function formatSignedAmountInput(raw: string, decimals = 2): string {
  const sign = raw.trimStart().startsWith("-") ? "-" : "";
  return sign + formatAmountInput(raw, decimals);
}

/** `amountToInput` that keeps the sign (-1234.56 → "-1.234,56"):
 *  `amountToInput` drops it, which would save a negative balance as positive. */
export function signedAmountToInput(value: number, decimals = 2): string {
  return (value < 0 ? "-" : "") + amountToInput(Math.abs(value), decimals);
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
export function formatNumber2(
  value: number | string | null | undefined,
): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n)) return "0,00";
  return moneyFmt2.format(n);
}

const rateFmt = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

/** "1.180,505" — an exchange rate: 2 to 6 decimals, no currency symbol. */
export function formatRate(value: number | string | null | undefined): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n)) return "0,00";
  return rateFmt.format(n);
}

/** "3.866" — integer, no decimals. */
export function formatInteger(
  value: number | string | null | undefined,
): string {
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

/** "may 2026" for a "2026-05" period; anything else unchanged. */
export function formatPeriod(value: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  const month = m ? MONTHS_ES[Number(m[2]) - 1] : undefined;
  return m && month ? `${month} ${m[1]}` : value;
}

/** "17 may 2026, 12:30" in Argentine time. A plain "yyyy-mm-dd" carries no
 *  time, so it renders as the date alone rather than an invented hour. */
export function formatArgentineDateTime(
  value: string | null | undefined,
): string {
  if (!value) return "—";
  if (PLAIN_DATE.test(value)) return formatArgentineDate(value);
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

/** "17/5/2026" — short es-AR date (the `toLocaleDateString("es-AR")` shape),
 *  built by hand so it does not depend on the runtime's time zone. Used by
 *  emails and attachments where the compact format is preferred over the "17 may 2026"
 *  of `formatArgentineDate`. Accepts an ISO string or Date; invalid → "—". */
export function formatArDateShort(
  value: string | Date | null | undefined,
): string {
  if (!value) return "—";
  const cal = arCalendarDay(value);
  if (!cal) return "—";
  return `${cal.day}/${cal.monthIndex + 1}/${cal.year}`;
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

/** An amount written either way ("1.234,56", "1,234.56", "1500.5") as
 *  ungrouped es-AR text ("1234,56"), or null when it is not one. Decides
 *  which mark is the decimal one:
 *  - both "." and ",": the last one ("1.234,56", "1,234.56" → "1234,56");
 *  - only ",": a single comma is the decimal mark (several are unreadable);
 *  - only one ".": thousands with exactly 3 digits after it ("15.000" →
 *    "15000"), otherwise decimal ("1500.5" → "1500,5");
 *  - several ".": thousands ("1.234.567" → "1234567").
 *  A trailing mark stays ("15," / "15." → "15,"). */
export function normalizeAmountText(raw: string): string | null {
  const sign = raw.startsWith("-") ? "-" : "";
  const body = sign ? raw.slice(1) : raw;
  if (!/^[\d.,]*$/.test(body) || !/\d/.test(body)) return null;
  const lastDot = body.lastIndexOf(".");
  const lastComma = body.lastIndexOf(",");
  let mark = -1;
  if (lastDot >= 0 && lastComma >= 0) {
    mark = Math.max(lastDot, lastComma);
  } else if (lastComma >= 0) {
    if (body.indexOf(",") !== lastComma) return null;
    mark = lastComma;
  } else if (lastDot >= 0 && body.indexOf(".") === lastDot) {
    if (body.length - lastDot - 1 !== 3) mark = lastDot;
  }
  if (mark < 0) return sign + body.replace(/\./g, "");
  const decimals = body.slice(mark + 1);
  if (!/^\d*$/.test(decimals)) return null;
  const int = body.slice(0, mark).replace(/[.,]/g, "");
  return `${sign}${int},${decimals}`;
}

/** Parses an amount in es-AR format ("1.234,56" → 1234.56), with the
 *  separator rules of `normalizeAmountText` ("1500.5" → 1500.5). Returns
 *  null unless the whole string is a number: "12abc" and "1e3" are null, not
 *  12 and 1000. It is the semantic inverse of `formatAmountInput` /
 *  `amountToInput`. */
export function parseArAmount(raw: string): number | null {
  const text = normalizeAmountText(raw.replace(/\s/g, ""));
  if (text === null) return null;
  const n = Number(text.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

type MoneyInputOptions = { decimals?: number; allowNegative?: boolean };

/** Text in the field's own es-AR grouping ("1.500", "-1.234,56"). */
const GROUPED_AMOUNT = /^-?\d{1,3}(\.\d{3})+(,\d*)?$/;

function formatMoneyText(
  text: string,
  { decimals = 2, allowNegative = false }: MoneyInputOptions,
): string {
  return allowNegative
    ? formatSignedAmountInput(text, decimals)
    : formatAmountInput(text, decimals);
}

/** The text a MoneyInput holds after an edit from `prev` to `raw`. While
 *  typing it keeps what the user typed (digits, "." and ","), so nothing
 *  fights the cursor, and `parseArAmount` reads that text with the rules of
 *  `normalizeAmountText` ("15.000" → 15000, "1500.50" → 1500,5). A second
 *  comma, or a dot after the comma, is ignored, and the digits after a comma
 *  stop at `decimals`. A paste with its own marks is read as a whole value
 *  and shown in es-AR; `moneyInputBlurText` formats typed text on blur. */
export function nextMoneyInputText(
  prev: string,
  raw: string,
  options: MoneyInputOptions = {},
): string {
  const { decimals = 2, allowNegative = false } = options;
  let start = 0;
  while (
    start < prev.length &&
    start < raw.length &&
    prev[start] === raw[start]
  )
    start++;
  let end = 0;
  while (
    end < prev.length - start &&
    end < raw.length - start &&
    prev[prev.length - 1 - end] === raw[raw.length - 1 - end]
  )
    end++;
  const inserted = raw.slice(start, raw.length - end);
  // A paste with its own marks ("1,234.56", "15.000") is read as a whole
  // value; digits alone just join what was there.
  if (inserted.length > 1 && /[.,]/.test(inserted)) {
    const pasted = normalizeAmountText(raw.replace(/[^\d.,-]/g, ""));
    return pasted === null ? prev : formatMoneyText(pasted, options);
  }
  // Editing a value the field already grouped ("1.500", "1.234,56"): its
  // dots are thousands, so they drop before the edit is read ("1.500" + "0"
  // is 15000, not 1,5000). A typed "." stays as typed.
  const typed = GROUPED_AMOUNT.test(prev)
    ? raw.slice(0, start).replace(/\./g, "") +
      inserted +
      raw.slice(raw.length - end).replace(/\./g, "")
    : raw;
  const sign = allowNegative && typed.trimStart().startsWith("-") ? "-" : "";
  const body = typed.replace(/[^\d.,]/g, "");
  const comma = body.indexOf(",");
  if (comma < 0) return sign + body;
  if (body.indexOf(",", comma + 1) >= 0 || body.indexOf(".", comma) >= 0) {
    return prev;
  }
  return sign + body.slice(0, comma + 1 + decimals);
}

/** A MoneyInput's text in canonical es-AR form ("1500.5" → "1.500,5",
 *  "15." → "15"), for when the field loses focus. Unreadable text stays. */
export function moneyInputBlurText(
  text: string,
  options: MoneyInputOptions = {},
): string {
  const normalized = normalizeAmountText(text.replace(/[^\d.,-]/g, ""));
  if (normalized === null) return text;
  return formatMoneyText(normalized, options).replace(/,$/, "");
}

/** A number from an imported statement cell, in either shape a spreadsheet
 *  hands over: es-AR text ("$ 1.234,56", "12.500") or a raw cell value
 *  ("1234.56"). A comma is always the decimal mark; without one, dots that
 *  group exact thousands ("1.234.567") are thousands, any other single dot is
 *  the decimal mark. Null when it is not a finite number. */
export function parseStatementNumber(raw: string): number | null {
  const cleaned = raw.replace(/[\s$]|ARS/gi, "");
  if (cleaned.includes(",")) return parseArAmount(cleaned);
  if (/^-?\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    return parseArAmount(cleaned);
  }
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
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
