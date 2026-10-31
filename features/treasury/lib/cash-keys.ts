import { accountsKeys } from "@/features/accounts/lib/accounts-keys";
import { transactionsKeys } from "@/features/transactions/lib/transactions-keys";

import { treasuryKeys } from "./treasury-keys";

/** What a cash movement changes: caja, account balances, the treasury
 *  summary and the cash flow. */
export const CASH_KEYS = [
  transactionsKeys.all,
  accountsKeys.all,
  treasuryKeys.all,
] as const;
