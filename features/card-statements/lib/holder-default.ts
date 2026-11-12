/** What a line (or a card's default) is: its treatment and destination. */
export type LineDestination = {
  treatment: string;
  chart_account_id: string | null;
  employee_id: string | null;
};

type CardLine = LineDestination & {
  card_last4: string | null;
  currency: string;
  source: string;
};

function sameDestination(a: LineDestination, b: LineDestination): boolean {
  return (
    a.treatment === b.treatment &&
    a.chart_account_id === b.chart_account_id &&
    a.employee_id === b.employee_id
  );
}

/** The lines of a paid part that a card's new default changes: the card's
 *  lines still on its previous default (a line changed by hand is left as
 *  it is) that the new default does change. A bank charge is never a
 *  salary advance, and an advance is Personal's: without its write it is
 *  left as it is. */
export function linesFollowingDefault<L extends CardLine>(
  lines: readonly L[],
  opts: {
    last4: string;
    previous: LineDestination | null;
    next: LineDestination;
    /** The paid parts (currencies) of the statement. */
    paidParts: readonly string[];
    hrWrite: boolean;
  },
): L[] {
  const { previous, next } = opts;
  if (!previous) return [];
  return lines.filter(
    (l) =>
      l.card_last4 === opts.last4 &&
      opts.paidParts.includes(l.currency) &&
      sameDestination(l, previous) &&
      !sameDestination(l, next) &&
      (next.treatment !== "advance" || l.source === "purchase") &&
      (opts.hrWrite || l.treatment !== "advance"),
  );
}
