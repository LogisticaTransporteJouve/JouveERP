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
  /** Bancos + efectivo + billeteras + inversión: lo realmente disponible. */
  liquid: number;
  /** Cheques físicos + e-cheq en cartera: no es liquidez hasta acreditarse. */
  checks: number;
};

export type TreasurySummary = {
  as_of: string;
  prev_eom: string;
  accounts: TreasuryAccountRow[];
  totals_now: Record<TreasuryCurrency, TreasuryCurrencyTotals>;
  totals_prev_eom: Record<TreasuryCurrency, TreasuryCurrencyTotals>;
  /** Cheques en cartera con vencimiento dentro de los próximos 7 días — los
   *  que están a punto de convertirse en liquidez (depósito/acreditación). */
  checks_due_soon: Record<TreasuryCurrency, { count: number; amount: number }>;
};

/** Tipos considerados "líquidos" para el total de moneda. Los tipos de
 *  cheques en cartera (checks, echeq) se suman aparte. */
export function isLiquidAccountType(type: AccountType): boolean {
  return type === "bank" || type === "cash" || type === "wallet" || type === "investment";
}

export function isCheckAccountType(type: AccountType): boolean {
  return type === "checks" || type === "echeq";
}
