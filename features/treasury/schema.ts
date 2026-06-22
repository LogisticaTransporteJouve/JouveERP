import type { AccountType } from "@/features/accounts/schema";

export type TreasuryCurrency = "ARS" | "USD";

export type TreasuryAccountRow = {
  id: string;
  name: string;
  type: AccountType;
  currency: TreasuryCurrency;
  is_active: boolean;
  balance_now: number;
  balance_prev_eom: number;
  last_movement_date: string | null;
};

export type TreasuryCurrencyTotals = {
  /** Banks + cash + wallets + investment: what's actually available. */
  liquid: number;
  /** Physical checks + e-cheq in portfolio: not liquidity until credited. */
  checks: number;
};

export type TreasurySummary = {
  as_of: string;
  prev_eom: string;
  accounts: TreasuryAccountRow[];
  totals_now: Record<TreasuryCurrency, TreasuryCurrencyTotals>;
  totals_prev_eom: Record<TreasuryCurrency, TreasuryCurrencyTotals>;
  /** Checks in portfolio due within the next 7 days — the ones about to
   *  turn into liquidity (deposit/crediting). */
  checks_due_soon: Record<TreasuryCurrency, { count: number; amount: number }>;
  /** Latest available USD→ARS exchange rate (the most recently loaded one), to
   *  show the ARS equivalent of dollar balances. null if none has been loaded
   *  yet. */
  usd_rate: { rate: number; rate_date: string } | null;
};

/** Types considered "liquid" for the currency total. The check-in-portfolio
 *  types (checks, echeq) are summed separately. */
export function isLiquidAccountType(type: AccountType): boolean {
  return type === "bank" || type === "cash" || type === "wallet" || type === "investment";
}

export function isCheckAccountType(type: AccountType): boolean {
  return type === "checks" || type === "echeq";
}
