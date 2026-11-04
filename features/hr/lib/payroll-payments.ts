import { isCheckAccount, type AccountType } from "@/features/accounts/schema";
import { JOUVE_GUARD_HINT } from "@/lib/db/guard-errors";
import { PG_CHECK_VIOLATION, PG_OBJECT_IN_USE } from "@/lib/db/pg-error-codes";

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

type DbError = {
  code?: string | null;
  message?: string | null;
  hint?: string | null;
} | null;

const CLOSED_PERIOD_MESSAGE =
  "El período contable de esa fecha está cerrado. Reabrilo en Contabilidad o usá otra fecha.";

/** `guard_journal_period_closed`'s bare message (pinned by a test). */
const CLOSED_PERIOD_GUARD_MESSAGE =
  /^El período contable \S+ está cerrado y no admite movimientos$/;

/** Native CHECK violations carry Postgres' own English text. */
const NATIVE_CHECK_MESSAGE = /violates check constraint/i;

/**
 * Turns database errors from payroll writes into messages a user can act on:
 * a `jouve_guard` refusal keeps its own text (a reconciled movement must say
 * so, not "closed period"), the closed-period guard gets the actionable
 * version, the unhinted payroll guards (23514) pass through, and anything
 * else becomes the caller's Spanish fallback instead of raw Postgres text.
 */
export function payrollDbErrorMessage(
  error: DbError,
  fallback: string,
): string {
  if (!error || !error.message) return fallback;
  if (error.hint === JOUVE_GUARD_HINT) {
    if (
      error.code === PG_OBJECT_IN_USE &&
      CLOSED_PERIOD_GUARD_MESSAGE.test(error.message)
    ) {
      return CLOSED_PERIOD_MESSAGE;
    }
    return error.message;
  }
  if (
    error.code === PG_CHECK_VIOLATION &&
    !NATIVE_CHECK_MESSAGE.test(error.message)
  ) {
    return error.message;
  }
  return fallback;
}
