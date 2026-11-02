/** Helpers for an accounting period `YYYY-MM` (journal_entries.accrual_period). */

/** The period's first and last day, as `YYYY-MM-DD`. */
export function periodBounds(period: string): { from: string; to: string } {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return {
    from: `${period}-01`,
    to: `${period}-${String(last).padStart(2, "0")}`,
  };
}

/** The month before `period`. */
export function previousPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`;
}

/** The period of a `YYYY-MM-DD` date. */
export function periodOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}
