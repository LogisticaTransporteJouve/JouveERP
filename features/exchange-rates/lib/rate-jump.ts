import { formatArgentineDate } from "@/lib/format";

import type { ExchangeRate } from "../schema";

/** A new rate further than this (as a fraction) from the stored one asks
 *  first: "1450.125" read as 1.450.125 is ×1000, a real move is far less. */
export const RATE_JUMP_LIMIT = 0.3;

/** A rate as the page shows it ("1.450,125"). */
export const rateFmt = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

/** A stored USD rate a new one is compared with; `earlier` when it is on or
 *  before the new rate's date. */
export type RateReference = {
  rate_date: string;
  rate: number;
  earlier: boolean;
};

/** The stored USD rate a new one for `date` is compared with: the nearest on
 *  or before that date, else the nearest after it (loading an older day). */
function referenceRate(
  rates: readonly Pick<ExchangeRate, "currency" | "rate_date" | "rate">[],
  date: string,
): RateReference | null {
  let before: Pick<ExchangeRate, "rate_date" | "rate"> | null = null;
  let after: Pick<ExchangeRate, "rate_date" | "rate"> | null = null;
  for (const r of rates) {
    if (r.currency !== "USD") continue;
    if (r.rate_date <= date) {
      if (!before || r.rate_date > before.rate_date) before = r;
    } else if (!after || r.rate_date < after.rate_date) {
      after = r;
    }
  }
  if (before) return { ...before, earlier: true };
  return after ? { ...after, earlier: false } : null;
}

/** The question to ask before saving `rate` for `date` when it is more than
 *  `RATE_JUMP_LIMIT` away from the stored rate, or null when it is not (or
 *  there is nothing to compare with). */
export function rateJumpWarning(
  rates: readonly Pick<ExchangeRate, "currency" | "rate_date" | "rate">[],
  date: string,
  rate: number,
): string | null {
  return rateJumpWarningFor(referenceRate(rates, date), rate);
}

/** `rateJumpWarning` against a reference already read: the AI CFO's
 *  proposal reads only the nearest stored rate, not the whole list. */
export function rateJumpWarningFor(
  ref: RateReference | null,
  rate: number,
): string | null {
  const refRate = Number(ref?.rate);
  if (!ref || !(refRate > 0)) return null;
  if (Math.abs(rate - refRate) / refRate <= RATE_JUMP_LIMIT) return null;
  return (
    `${ref.earlier ? "La última cotización fue" : "La siguiente cotización es"} ` +
    `${rateFmt.format(refRate)} ` +
    `(${formatArgentineDate(ref.rate_date)}) y esta es ${rateFmt.format(rate)}: ` +
    `difiere en más de un ${RATE_JUMP_LIMIT * 100}%. ¿Seguro que es correcta?`
  );
}
