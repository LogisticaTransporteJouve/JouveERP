// Pure helpers over a client's already-billed periods (storage_billing_runs).
// Used to autocontinue the billing "desde", warn about uncovered gaps, and
// block overlapping (double) billing. No DB.

const DAY_MS = 24 * 60 * 60 * 1000;

export type BilledPeriod = { period_start: string; period_end: string };

function dayNum(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}
function toDate(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** Latest billed date for the client, or null if never billed. */
export function lastBilledEnd(runs: BilledPeriod[]): string | null {
  if (runs.length === 0) return null;
  let max = -Infinity;
  for (const r of runs) max = Math.max(max, dayNum(r.period_end));
  return toDate(max);
}

/** Suggested next "desde" = last billed end + 1 day (null if never billed). */
export function suggestedStart(runs: BilledPeriod[]): string | null {
  const last = lastBilledEnd(runs);
  return last === null ? null : toDate(dayNum(last) + 1);
}

/**
 * If `proposedStart` skips days after the last billed period, returns the
 * uncovered gap [from, to] so the UI can warn; else null. Only forward gaps —
 * billing earlier dates out of order is caught by the overlap guard instead.
 */
export function uncoveredGap(
  runs: BilledPeriod[],
  proposedStart: string,
): { from: string; to: string } | null {
  const last = lastBilledEnd(runs);
  if (last === null) return null;
  const gapStart = dayNum(last) + 1;
  const start = dayNum(proposedStart);
  if (start > gapStart) {
    return { from: toDate(gapStart), to: toDate(start - 1) };
  }
  return null;
}

/** True if [start, end] overlaps any already-billed period for the client. */
export function overlapsBilled(
  runs: BilledPeriod[],
  start: string,
  end: string,
): boolean {
  const s = dayNum(start);
  const e = dayNum(end);
  return runs.some((r) => {
    const rs = dayNum(r.period_start);
    const re = dayNum(r.period_end);
    return s <= re && e >= rs;
  });
}
