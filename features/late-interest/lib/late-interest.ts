// Interés por mora: simple interest on the daily balance at a monthly rate,
// prorated /30 per day, from the day after the due date (or after the last
// charged day) to the as-of date, both inclusive. The daily balance comes
// summed from late_interest_candidates (balance_days): a payment in the
// middle of the period lowers it from its date on.

const DAY_MS = 24 * 60 * 60 * 1000;

function dayNum(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

/** Inclusive days from `from` to `to`; 0 when `to` is before `from`. */
export function inclusiveDays(from: string, to: string): number {
  return Math.max(0, dayNum(to) - dayNum(from) + 1);
}

export function computeLateInterest(input: {
  /** Σ of the comprobante's balance over each day of [from, to]. */
  balanceDays: number;
  /** Monthly %, e.g. 3 = 3% per month. */
  monthlyRate: number;
  from: string;
  to: string;
}): { days: number; interest: number; averageBalance: number } {
  const days = inclusiveDays(input.from, input.to);
  if (days === 0 || input.balanceDays <= 0 || input.monthlyRate <= 0) {
    return { days, interest: 0, averageBalance: 0 };
  }
  const interest =
    Math.round(((input.balanceDays * input.monthlyRate) / 100 / 30) * 100) /
    100;
  const averageBalance = Math.round((input.balanceDays / days) * 100) / 100;
  return { days, interest, averageBalance };
}

/** "FC A 0001-00000123" style label of the overdue comprobante. */
export function comprobanteLabel(c: {
  kind: string;
  letter: string | null;
  punto_venta: number;
  numero: number | null;
}): string {
  const kind = c.kind === "nd" ? "ND" : "FC";
  const pv = String(c.punto_venta).padStart(4, "0");
  const nro = c.numero === null ? "—" : String(c.numero).padStart(8, "0");
  return [kind, c.letter, `${pv}-${nro}`].filter(Boolean).join(" ");
}

function ddmmyyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** The ND line. */
export function lateInterestDescription(c: {
  kind: string;
  letter: string | null;
  punto_venta: number;
  numero: number | null;
  from: string;
  to: string;
  days: number;
  monthlyRate: number;
}): string {
  return `Intereses por mora s/ ${comprobanteLabel(c)} del ${ddmmyyyy(c.from)} al ${ddmmyyyy(c.to)} (${c.days} días al ${c.monthlyRate}% mensual)`;
}
