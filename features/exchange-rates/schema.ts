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
 * Cotización aplicable a una fecha: la del día, o la anterior más cercana
 * (`rate_date <= date`). Devuelve null si no hay ninguna cotización en o antes
 * de esa fecha — el llamador decide qué hacer (no asumimos una cotización).
 */
export function findRateForDate(
  rates: Pick<ExchangeRate, "rate_date" | "rate">[],
  date: string,
): number | null {
  // El UNIQUE (currency, rate_date) en DB garantiza que no haya dos filas con
  // la misma fecha, así que el desempate de `>` no se ejerce en la práctica.
  let best: { rate_date: string; rate: number } | null = null;
  for (const r of rates) {
    if (r.rate_date > date) continue;
    if (!best || r.rate_date > best.rate_date) best = r;
  }
  return best ? Number(best.rate) : null;
}

/** Convierte un monto en USD a ARS con la cotización dada (ARS por 1 USD). */
export function convertUsdToArs(amountUsd: number, rate: number): number {
  return round2(amountUsd * rate);
}
