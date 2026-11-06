// Small Spanish wording helpers shared by the sentence registry and the
// name resolver.

import { formatMoney, formatNumber2 } from "@/lib/format";
import { isUsdCurrency } from "@/lib/fx";

/** "0003-00022312"; "(sin número)" while a document has none yet. */
export function documentNumber(
  pos: number,
  numero: number | null,
  posDigits: 4 | 5,
): string {
  const p = String(pos).padStart(posDigits, "0");
  return numero === null
    ? `${p} (sin número)`
    : `${p}-${String(numero).padStart(8, "0")}`;
}

/** "Factura A", "Nota de crédito", "Remito interno" (a factura with no
 *  letter is an internal remito, Otras ventas). */
export function invoiceNoun(kind: string, letter: string | null): string {
  if (kind === "nc") return "Nota de crédito";
  if (kind === "nd") return "Nota de débito";
  return letter ? `Factura ${letter}` : "Remito interno";
}

/** "Factura de compra A", "Nota de crédito de compra". */
export function purchaseNoun(kind: string, letter: string | null): string {
  if (kind === "nc") return "Nota de crédito de compra";
  if (kind === "nd") return "Nota de débito de compra";
  return letter ? `Factura de compra ${letter}` : "Factura de compra";
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;

/** "07/11/2026" for "2026-11-07"; anything else unchanged. */
export function shortDate(value: unknown): string {
  if (typeof value !== "string") return "—";
  const m = ISO_DATE.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

/** "11/2026" for "2026-11"; a date or anything else via shortDate. */
export function shortPeriod(value: unknown): string {
  if (typeof value !== "string") return "—";
  const m = ISO_MONTH.exec(value);
  return m ? `${m[2]}/${m[1]}` : shortDate(value);
}

export function money(value: unknown, currency?: unknown): string | null {
  const n = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || !Number.isFinite(n)) return null;
  return formatMoney(
    n,
    typeof currency === "string" && isUsdCurrency(currency) ? "USD" : "ARS",
  );
}

/** "3 %" for 3, "2,5 %" for 2.5. */
export function percent(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${formatNumber2(n).replace(/,00$/, "")} %`;
}

/** "1 factura" / "3 facturas". */
export function count(n: unknown, one: string, many: string): string {
  const k = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return `${k} ${k === 1 ? one : many}`;
}

/** "A", "A y B", "A, B y C"; «e» before a word that sounds like «i»
 *  («IVA Compras e Impuestos»). */
export function joinAnd(items: readonly string[]): string {
  const last = items.at(-1);
  if (items.length <= 1 || last === undefined) return last ?? "";
  const and = /^h?i(?![aeiouáéó])/i.test(last) ? "e" : "y";
  return `${items.slice(0, -1).join(", ")} ${and} ${last}`;
}
