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

// Money formatters centralizados (replicados en 23 archivos antes de esto).
// Usar siempre estos helpers en lugar de armar `Intl.NumberFormat` inline.

const moneyFmt2 = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const moneyFmt0 = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** "3.865,59" — sin símbolo de moneda. */
export function formatNumber2(value: number | string | null | undefined): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n)) return "0,00";
  return moneyFmt2.format(n);
}

/** "3.866" — entero, sin decimales. */
export function formatInteger(value: number | string | null | undefined): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return moneyFmt0.format(Math.round(n));
}

/** "$ 3.865,59" — peso por default; "US$ 3.865,59" si currency === "USD". */
export function formatMoney(
  value: number | string | null | undefined,
  currency: "ARS" | "USD" | string = "ARS",
): string {
  const sign = currency === "USD" ? "US$" : "$";
  return `${sign} ${formatNumber2(value)}`;
}

/** "-$ 3.865,59" — formatMoney con signo respetando negativos. */
export function formatMoneySigned(
  value: number | string | null | undefined,
  currency: "ARS" | "USD" | string = "ARS",
): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (n < 0) return `-${formatMoney(-n, currency)}`;
  return formatMoney(n, currency);
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

/** "YYYY-MM-DD" del día actual en hora Argentina (UTC-3). Usado como default
 *  para los date inputs de los forms (recibos, cheques, transacciones, OPs). */
export function todayInAR(): string {
  const ar = new Date(Date.now() - AR_OFFSET_MS);
  return ar.toISOString().slice(0, 10);
}

/** Redondeo a 2 decimales — usado en cálculos monetarios (IVA, totales,
 *  cotizaciones). Centralizado para evitar las 4+ copias verbatim que
 *  vivían en schemas, actions, inngest y renders. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Parsea un monto en formato es-AR ("1.234,56" → 1234.56). Devuelve null
 *  si la cadena no representa un número finito. Es el inverso semántico de
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
