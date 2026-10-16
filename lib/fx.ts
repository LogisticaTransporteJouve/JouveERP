import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database";
import { round2 } from "@/lib/format";
import { logger } from "@/lib/logger";

/** Official USD→ARS rate (ARS per 1 USD) and the day it applies to. */
export type UsdRate = { rate: number; rate_date: string };

/** True for the dollar under either code: AFIP's "DOL" or ISO "USD". */
export function isUsdCurrency(code: string | null | undefined): boolean {
  return code === "USD" || code === "DOL";
}

/** Latest loaded official rate (BCRA cron or a manual override), or null when
 *  none is loaded or the read fails — callers treat both as "no rate". */
export async function fetchLatestUsdRate(
  supabase: SupabaseClient<Database>,
): Promise<UsdRate | null> {
  const { data, error } = await supabase
    .from("exchange_rates")
    .select("rate, rate_date")
    .eq("currency", "USD")
    .order("rate_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.warn("exchange_rates.latest.failed", { error });
    return null;
  }
  return data ? { rate: Number(data.rate), rate_date: data.rate_date } : null;
}

/** ARS value of `amount` in `currency`: USD at `usdRate`, anything else as
 *  pesos. Null when it is USD and there is no rate. */
export function toArs(
  amount: number,
  currency: string | null,
  usdRate: number | null,
): number | null {
  if (!isUsdCurrency(currency)) return amount;
  return usdRate === null ? null : amount * usdRate;
}

/** `ars + usd × rate`, rounded to cents. Null when there are dollars and no
 *  rate: a single figure would otherwise silently drop or mis-value them. */
export function arsEquivalent(
  ars: number,
  usd: number,
  usdRate: number | null,
): number | null {
  if (usd === 0) return round2(ars);
  if (usdRate === null) return null;
  return round2(ars + usd * usdRate);
}
