// CUIT/CUIL validation (Argentine tax id) with the mod-11 check digit.
// Catches typos before they reach AFIP or the Libro IVA Digital TXT export.

const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

/** Strips non-digits and returns the 11-digit CUIT, or null if not 11 digits. */
export function normalizeCuit(value: string): string | null {
  const clean = value.replace(/[^0-9]/g, "");
  return clean.length === 11 ? clean : null;
}

/** True when `value` is a syntactically valid CUIT/CUIL (11 digits + check digit). */
export function isValidCuit(value: string): boolean {
  const clean = normalizeCuit(value);
  if (!clean) return false;
  const digits = clean.split("").map((d) => Number(d));
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * digits[i]!, 0);
  const mod = 11 - (sum % 11);
  const check = mod === 11 ? 0 : mod === 10 ? 9 : mod;
  return check === digits[10];
}

/** Formats typed input as XX-XXXXXXXX-X, keeping at most 11 digits. */
export function formatCuitInput(value: string): string {
  const digits = value.replace(/[^0-9]/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 10) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}
