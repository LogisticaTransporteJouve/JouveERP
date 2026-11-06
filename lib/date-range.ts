/** Plain-date helpers (`YYYY-MM-DD`) in the local timezone, for date inputs.
 *  List periods live in `lib/list-period`. */

/** Today's date in the local timezone, as `YYYY-MM-DD`. */
export function todayIsoLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Date → `YYYY-MM-DD` in local timezone. */
export function dateToIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** `YYYY-MM-DD` → Date (local timezone), or undefined if invalid. */
export function isoToDate(iso: string): Date | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

/** A `YYYY-MM-DD` date moved `days` calendar days (negative goes back). */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** The calendar months between from and to (YYYY-MM-DD), as [from, to]
 *  ranges clipped to the bounds. */
export function monthRanges(from: string, to: string): [string, string][] {
  const out: [string, string][] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  for (;;) {
    const first = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const last = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    if (first > to) break;
    out.push([first < from ? from : first, last > to ? to : last]);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
