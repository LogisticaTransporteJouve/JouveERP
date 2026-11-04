// Pure helpers over a client's already-billed periods (storage_billing_runs).
// Used to autocontinue the billing "desde", warn about uncovered gaps, and
// block overlapping (double) billing. No DB.

const DAY_MS = 24 * 60 * 60 * 1000;

export type BilledPeriod = { period_start: string; period_end: string };

export type ClaimedRun = BilledPeriod & {
  client_id: string;
  invoice_id: string | null;
  channel_id: string | null;
};

function onChannel(run: ClaimedRun, channelId: string | null): boolean {
  return (
    channelId === null ||
    run.channel_id === null ||
    run.channel_id === channelId
  );
}

/**
 * The client's runs that bill their days on `channelId`, by the rule of
 * claim_storage_billing_period: a run linked to an invoice, on that channel
 * or with none (an older run). A pending claim is not billed yet: the server
 * refuses it while fresh, and once stale it links the invoice issued under
 * it or frees the days. With no channel chosen, every channel counts.
 */
export function billedRuns<T extends ClaimedRun>(
  runs: T[],
  clientId: string,
  channelId: string | null,
): T[] {
  return runs.filter(
    (r) =>
      r.client_id === clientId &&
      r.invoice_id !== null &&
      onChannel(r, channelId),
  );
}

/** The client's pending claims (no invoice linked yet) on `channelId`. */
export function pendingRuns<T extends ClaimedRun>(
  runs: T[],
  clientId: string,
  channelId: string | null,
): T[] {
  return runs.filter(
    (r) =>
      r.client_id === clientId &&
      r.invoice_id === null &&
      onChannel(r, channelId),
  );
}

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
