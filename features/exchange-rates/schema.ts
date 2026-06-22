import { z } from "zod";

import type { Database } from "@/lib/db/database.types";
import { round2 } from "@/lib/format";

export const EXCHANGE_RATES_PATH = "/accounting/exchange-rates";

export type ExchangeRate =
  Database["public"]["Tables"]["exchange_rates"]["Row"];

export const isoDate = z
  .string()
  .regex(
    /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/,
    "Formato YYYY-MM-DD.",
  );

export const ExchangeRateCreateSchema = z.object({
  rate_date: isoDate,
  rate: z
    .number({ message: "Cotización requerida." })
    .positive("Debe ser mayor a cero.")
    .max(9_999_999.999999, "Demasiado alta."),
  notes: z.string().trim().max(500).optional().nullable(),
});

export type ExchangeRateCreateInput = z.infer<typeof ExchangeRateCreateSchema>;

export const ExchangeRateDeleteSchema = z.object({
  id: z.string().uuid(),
});

/**
 * Rate applicable to a date: the one for that day, or the nearest earlier
 * one (`rate_date <= date`). Returns null if there is no rate on or before
 * that date — the caller decides what to do (we don't assume a rate).
 */
export function findRateForDate(
  rates: Pick<ExchangeRate, "rate_date" | "rate">[],
  date: string,
): number | null {
  // The UNIQUE (currency, rate_date) in DB guarantees there are no two rows
  // with the same date, so the `>` tie-break isn't exercised in practice.
  let best: { rate_date: string; rate: number } | null = null;
  for (const r of rates) {
    if (r.rate_date > date) continue;
    if (!best || r.rate_date > best.rate_date) best = r;
  }
  return best ? Number(best.rate) : null;
}

/** Converts a USD amount to ARS with the given rate (ARS per 1 USD). */
export function convertUsdToArs(amountUsd: number, rate: number): number {
  return round2(amountUsd * rate);
}
