import type { LedgerRow } from "../schema";

export const LEDGER_MAX_ROWS = 1000;

export type LedgerResult = {
  rows: LedgerRow[];
  truncated: boolean;
};
