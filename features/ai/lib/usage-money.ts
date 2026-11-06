import type { UsdRate } from "@/lib/fx";
import { formatArgentineDate, formatInteger, formatMoney } from "@/lib/format";

/** Today's AI spend and the daily cap, in USD, with the official dollar to
 *  show them in pesos (null when no rate is loaded). */
export type AiSpendToday = {
  costUsd: number;
  capUsd: number;
  usdRate: UsdRate | null;
};

export type AiSpendView = {
  /** «$ 803»: today's spend in pesos (US$ without a rate). */
  spent: string;
  /** «$ 2.318»: the cap, in the same currency as `spent`. */
  cap: string;
  /** 0–100, for the bar. */
  pct: number;
  atCap: boolean;
  tooltip: string;
};

const pesos = (n: number) => `$ ${formatInteger(n)}`;

/** How the /ai header reads today's spend: pesos at the official dollar, or
 *  dollars when no rate is loaded. Never tokens. */
export function aiSpendView({
  costUsd,
  capUsd,
  usdRate,
}: AiSpendToday): AiSpendView {
  const pct =
    capUsd > 0 ? Math.min(100, Math.round((costUsd / capUsd) * 100)) : 0;
  const atCap = costUsd >= capUsd;
  const usd = formatMoney(costUsd, "USD");
  if (!usdRate) {
    return {
      spent: usd,
      cap: formatMoney(capUsd, "USD"),
      pct,
      atCap,
      tooltip: `Gasto de IA de hoy: ${usd} (sin cotización del dólar cargada)`,
    };
  }
  const spent = pesos(costUsd * usdRate.rate);
  return {
    spent,
    cap: pesos(capUsd * usdRate.rate),
    pct,
    atCap,
    tooltip: `Gasto de IA de hoy: ${usd} ≈ ${spent} al dólar oficial del ${formatArgentineDate(usdRate.rate_date)}`,
  };
}
