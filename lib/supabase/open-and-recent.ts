// Lists that keep every row still being worked (checks in cartera, own checks
// not yet cashed) and only the latest settled ones: the open rows are drained
// in full, the settled ones are read newest first capped at `cap` (the caller
// asks for `cap + 1` to know whether more exist).

/** Rows settled after the open ones the list shows at most. */
export const SETTLED_LIST_CAP = 500;

type Dated = { id: string; due_date: string };

/** Open rows plus the newest `cap` settled ones (read `cap + 1`, newest
 *  first), soonest due first. `truncated` = older settled rows were left out. */
export function mergeOpenAndRecent<T extends Dated>(
  open: readonly T[],
  settledNewestFirst: readonly T[],
  cap: number = SETTLED_LIST_CAP,
): { rows: T[]; truncated: boolean } {
  const rows = [...open, ...settledNewestFirst.slice(0, cap)].sort(
    (a, b) => a.due_date.localeCompare(b.due_date) || a.id.localeCompare(b.id),
  );
  return { rows, truncated: settledNewestFirst.length > cap };
}
