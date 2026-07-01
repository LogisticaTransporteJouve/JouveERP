import type { InvoiceExtraction } from "./schemas";
import { VALID_ALICUOTAS, type Alicuota } from "./types";

// Deterministic post-inference (no LLM): fill what the document didn't print,
// using accounting identities. Keeps extraction honest — the model returns what
// it sees, the math derives the rest. docs/ai-overview.md §5-bis step 4.

const ALICUOTA_SNAP_TOLERANCE = 0.1;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Amount triangle: neto + iva + trib = total. Given any two of {neto, iva,
 * total} (trib defaults to 0), derive the third. Returns the (possibly
 * completed) trio; a field stays null if it can't be derived.
 */
export function completeAmounts(input: {
  neto: number | null | undefined;
  iva: number | null | undefined;
  total: number | null | undefined;
  trib?: number | null | undefined;
}): { neto: number | null; iva: number | null; total: number | null } {
  const trib = input.trib ?? 0;
  let neto = input.neto ?? null;
  let iva = input.iva ?? null;
  let total = input.total ?? null;

  if (neto !== null && iva !== null && total === null) {
    total = round2(neto + iva + trib);
  } else if (neto !== null && total !== null && iva === null) {
    iva = round2(total - neto - trib);
  } else if (iva !== null && total !== null && neto === null) {
    neto = round2(total - iva - trib);
  }

  return { neto, iva, total };
}

/**
 * Normalize a raw VAT rate (number like 21 or 0.21, or string like "21%",
 * "10,5", "exento") to a valid Argentine alícuota, or null if unrecognizable.
 */
export function normalizeAlicuota(raw: unknown): Alicuota | null {
  if (raw === null || raw === undefined) return null;

  let value: number;
  if (typeof raw === "number") {
    value = raw;
  } else if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (/(exent|no\s*grav|^0$)/.test(s)) return 0;
    const cleaned = s.replace("%", "").replace(",", ".").trim();
    const parsed = Number(cleaned);
    if (Number.isNaN(parsed)) return null;
    value = parsed;
  } else {
    return null;
  }

  // Fractions like 0.21 → 21 (but keep a genuine 0).
  if (value > 0 && value <= 1) value *= 100;

  let best: Alicuota | null = null;
  let bestDist = Infinity;
  for (const a of VALID_ALICUOTAS) {
    const dist = Math.abs(a - value);
    if (dist < bestDist) {
      bestDist = dist;
      best = a;
    }
  }
  return bestDist <= ALICUOTA_SNAP_TOLERANCE ? best : null;
}

/**
 * Completes a line's amounts from quantity × unit price (less discount) and the
 * VAT rate. Only derives a field that's missing; never overwrites a value the
 * document already provided.
 */
export function computeItemTotals(item: {
  quantity?: number | null;
  unit_price?: number | null;
  discount_pct?: number | null;
  alicuota?: Alicuota | null;
  net_amount?: number | null;
  iva_amount?: number | null;
  total_amount?: number | null;
}): {
  net_amount: number | null;
  iva_amount: number | null;
  total_amount: number | null;
} {
  let neto = item.net_amount ?? null;
  let iva = item.iva_amount ?? null;
  let total = item.total_amount ?? null;

  if (
    neto === null &&
    item.quantity != null &&
    item.unit_price != null
  ) {
    const bonif = item.discount_pct ?? 0;
    neto = round2(item.quantity * item.unit_price * (1 - bonif / 100));
  }

  if (iva === null && neto !== null && item.alicuota != null) {
    iva = round2((neto * item.alicuota) / 100);
  }

  if (total === null && neto !== null && iva !== null) {
    total = round2(neto + iva);
  }

  return { net_amount: neto, iva_amount: iva, total_amount: total };
}

/**
 * If every line that declares a VAT rate shares the same one, return it (so
 * lines that didn't print a rate can inherit it). Returns null when rates are
 * mixed or none are present.
 */
export function inferUniformAlicuota(
  rates: (Alicuota | null)[],
): Alicuota | null {
  const present = rates.filter((r): r is Alicuota => r !== null);
  if (present.length === 0) return null;
  const first = present[0]!;
  return present.every((r) => r === first) ? first : null;
}

/**
 * Derive a due date from an invoice date + payment terms. Handles "contado"/
 * "efectivo" (same day) and "N días" patterns. Returns YYYY-MM-DD or null.
 */
export function dueDateFromTerms(
  fecha: string | null | undefined,
  condicionPago: string | null | undefined,
): string | null {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  if (!condicionPago) return null;

  const terms = condicionPago.trim().toLowerCase();
  let days: number | null = null;
  if (/(contado|efectivo|contra\s*entrega)/.test(terms)) {
    days = 0;
  } else {
    const match = terms.match(/(\d{1,3})\s*d[ií]as?/);
    if (match) days = Number(match[1]);
  }
  if (days === null) return null;

  const date = new Date(`${fecha}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Applies all deterministic fill-ins to an extracted invoice: per-line VAT-rate
 * normalization + line totals, header amount triangle, and due-date from payment
 * terms. Pure — never overwrites a value the document already provided.
 */
export function applyInvoicePostInference(
  inv: InvoiceExtraction,
): InvoiceExtraction {
  const items = inv.items.map((item) => {
    const alicuota = normalizeAlicuota(item.iva_rate);
    const totals = computeItemTotals({
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount_pct: item.discount_pct,
      alicuota,
      net_amount: item.net_amount,
      iva_amount: item.iva_amount,
      total_amount: item.total_amount,
    });
    return { ...item, iva_rate: alicuota, ...totals };
  });

  const header = completeAmounts({
    neto: inv.net_amount,
    iva: inv.iva_amount,
    total: inv.total_amount,
    trib: inv.other_taxes_amount,
  });

  // Resolve a rate for lines that didn't print one: the uniform line rate if
  // there is one, else 0 when the header shows no IVA (exento / no gravado).
  const uniform = inferUniformAlicuota(items.map((i) => i.iva_rate ?? null));
  const zeroFromHeader = header.iva === 0 ? 0 : null;
  const resolvedRate = uniform ?? zeroFromHeader;

  const filledItems =
    resolvedRate === null
      ? items
      : items.map((item) => {
          if (item.iva_rate != null) return item;
          const totals = computeItemTotals({
            quantity: item.quantity,
            unit_price: item.unit_price,
            discount_pct: item.discount_pct,
            alicuota: resolvedRate,
            net_amount: item.net_amount,
            iva_amount: item.iva_amount,
            total_amount: item.total_amount,
          });
          return { ...item, iva_rate: resolvedRate, ...totals };
        });

  return {
    ...inv,
    net_amount: header.neto,
    iva_amount: header.iva,
    total_amount: header.total,
    due_date:
      inv.due_date ?? dueDateFromTerms(inv.date, inv.payment_terms),
    items: filledItems,
  };
}
