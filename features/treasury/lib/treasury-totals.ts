import { round2 } from "@/lib/format";

import {
  isCheckAccountType,
  isLiquidAccountType,
  type TreasuryAccountRow,
  type TreasuryCurrency,
} from "../schema";

export type TreasuryTotals = {
  liquid_now: Record<TreasuryCurrency, number>;
  liquid_prev_eom: Record<TreasuryCurrency, number>;
  checks_now: Record<TreasuryCurrency, number>;
  checks_prev_eom: Record<TreasuryCurrency, number>;
};

/** Liquid balances and check carteras, each per currency (pesos and dollars
 *  never sum), rounded to the cent after summing. */
export function treasuryTotals(
  accounts: readonly Pick<
    TreasuryAccountRow,
    "type" | "currency" | "balance_now" | "balance_prev_eom"
  >[],
): TreasuryTotals {
  const zero = (): Record<TreasuryCurrency, number> => ({ ARS: 0, USD: 0 });
  const out: TreasuryTotals = {
    liquid_now: zero(),
    liquid_prev_eom: zero(),
    checks_now: zero(),
    checks_prev_eom: zero(),
  };
  for (const a of accounts) {
    if (isLiquidAccountType(a.type)) {
      out.liquid_now[a.currency] += a.balance_now;
      out.liquid_prev_eom[a.currency] += a.balance_prev_eom;
    } else if (isCheckAccountType(a.type)) {
      out.checks_now[a.currency] += a.balance_now;
      out.checks_prev_eom[a.currency] += a.balance_prev_eom;
    }
  }
  for (const figure of Object.values(out)) {
    for (const cur of ["ARS", "USD"] as const) {
      figure[cur] = round2(figure[cur]);
    }
  }
  return out;
}
