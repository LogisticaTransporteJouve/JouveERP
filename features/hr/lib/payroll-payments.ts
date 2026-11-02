import { isCheckAccount, type AccountType } from "@/features/accounts/schema";

/** Pesos below this gap are rounding, not an overpayment. */
const OVERPAY_TOLERANCE = 0.01;

type PayableAccountFields = {
  is_active: boolean;
  currency: string;
  type: AccountType;
};

/**
 * Accounts a salary can be paid from: active ARS cash/bank accounts. The
 * payment always posts an ARS expense, so a USD account or a check portfolio
 * would corrupt balances (the database enforces the same rule).
 */
export function payrollPayableAccounts<T extends PayableAccountFields>(
  accounts: readonly T[],
): T[] {
  return accounts.filter(
    (a) => a.is_active && a.currency === "ARS" && !isCheckAccount(a.type),
  );
}

/** True when paying `amount` would leave the entry with a negative balance. */
export function exceedsBalance(amount: number, saldo: number): boolean {
  return amount - Math.max(saldo, 0) > OVERPAY_TOLERANCE;
}

type DbError = { code?: string | null; message?: string | null } | null;

/** Turns database errors from payroll writes into messages a user can act on. */
export function payrollDbErrorMessage(
  error: DbError,
  fallback: string,
): string {
  if (!error) return fallback;
  if (error.code === "55006") {
    return "El período contable de esa fecha está cerrado. Reabrilo en Contabilidad o usá otra fecha.";
  }
  if (error.code === "23514" && error.message) return error.message;
  return error.message || fallback;
}
