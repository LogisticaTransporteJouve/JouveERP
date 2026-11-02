import type { LedgerRow } from "../schema";

/** Lines shown per read: one below PostgREST's max_rows (1000), so a full
 *  page from the server tells a capped ledger from a complete one. */
export const LEDGER_MAX_ROWS = 999;

export type LedgerResult = {
  rows: LedgerRow[];
  truncated: boolean;
  /** Balance before the range's "desde" date (0 without one). */
  opening: number;
};
