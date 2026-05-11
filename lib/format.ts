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
