export type LedgerRow = {
  entry_id: string;
  line_id: string;
  entry_date: string;
  accrual_period: string;
  description: string;
  source_table: string | null;
  source_id: string | null;
  channel_id: string | null;
  is_reversal: boolean;
  debit: string | number;
  credit: string | number;
  line_desc: string | null;
  running: string | number;
  account_code: string;
  account_name: string;
};

export type LedgerSummary = {
  totalDebit: number;
  totalCredit: number;
  finalBalance: number;
};

/** Totals of the shown lines, newest first; the final balance is the newest
 *  line's running balance, or the opening with no lines. */
export function computeLedgerSummary(
  rows: readonly LedgerRow[],
  opening = 0,
): LedgerSummary {
  let totalDebit = 0;
  let totalCredit = 0;
  for (const r of rows) {
    totalDebit += Number(r.debit);
    totalCredit += Number(r.credit);
  }
  return {
    totalDebit,
    totalCredit,
    finalBalance: rows.length > 0 ? Number(rows[0]!.running) : opening,
  };
}
