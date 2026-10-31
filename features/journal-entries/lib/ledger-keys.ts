import { balanceKeys } from "@/features/balance/lib/balance-keys";
import { libroMayorKeys } from "@/features/libro-mayor/lib/libro-mayor-keys";

import { journalEntriesKeys } from "./journal-entries-keys";

/** What a fiscal document's automatic entry changes: the journal, the
 *  general ledger and the balances read from it. */
export const LEDGER_KEYS = [
  journalEntriesKeys.all,
  libroMayorKeys.all,
  balanceKeys.all,
] as const;
