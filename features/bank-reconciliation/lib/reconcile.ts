import type {
  BookMovement,
  MatchSuggestion,
  ReconciliationSummary,
  StatementLine,
} from "../schema";

// Pure pieces of the reconciliation page: the suggested matches and the
// balances. The action reads the rows; nothing here touches the database.

const DAY_MS = 24 * 60 * 60 * 1000;

function dayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

function cents(amount: number): number {
  return Math.round(amount * 100);
}

/** The tokens of a line that identify it in a movement's description: its
 *  reference, and each number of 4 or more digits in its text. */
export function referenceTokens(
  line: Pick<StatementLine, "reference" | "description">,
): string[] {
  const tokens = new Set<string>();
  const reference = line.reference?.trim().toLowerCase();
  if (reference && reference.length >= 3) tokens.add(reference);
  for (const match of line.description.matchAll(/\d{4,}/g)) {
    tokens.add(match[0]);
  }
  return [...tokens];
}

/**
 * One-to-one suggestions for the open lines: a movement not yet reconciled,
 * of exactly the same signed amount, dated within `dayWindow` days of the
 * line. Pairs whose reference matches go first, then the closest dates; each
 * line and movement is used once. A user accepts or ignores each one.
 */
export function suggestMatches(
  lines: readonly StatementLine[],
  movements: readonly BookMovement[],
  dayWindow: number,
): MatchSuggestion[] {
  const free = movements.filter((m) => m.line_ids.length === 0);
  const candidates: (MatchSuggestion & { order: number })[] = [];
  lines.forEach((line, order) => {
    if (line.status !== "open") return;
    const tokens = referenceTokens(line);
    const lineDay = dayNumber(line.line_date);
    for (const m of free) {
      if (cents(m.signed_amount) !== cents(line.amount)) continue;
      const days = Math.abs(dayNumber(m.transaction_date) - lineDay);
      if (days > dayWindow) continue;
      const text = (m.description ?? "").toLowerCase();
      candidates.push({
        line_id: line.id,
        transaction_id: m.id,
        days,
        reference_match: tokens.some((t) => text.includes(t)),
        order,
      });
    }
  });
  candidates.sort(
    (a, b) =>
      Number(b.reference_match) - Number(a.reference_match) ||
      a.days - b.days ||
      a.order - b.order ||
      a.transaction_id.localeCompare(b.transaction_id),
  );
  const usedLines = new Set<string>();
  const usedMovements = new Set<string>();
  const out: MatchSuggestion[] = [];
  for (const c of candidates) {
    if (usedLines.has(c.line_id) || usedMovements.has(c.transaction_id)) {
      continue;
    }
    usedLines.add(c.line_id);
    usedMovements.add(c.transaction_id);
    out.push({
      line_id: c.line_id,
      transaction_id: c.transaction_id,
      days: c.days,
      reference_match: c.reference_match,
    });
  }
  return out;
}

/** Sum of signed amounts, rounded to the cent. */
export function sumAmounts(amounts: readonly number[]): number {
  return amounts.reduce((acc, a) => acc + cents(a), 0) / 100;
}

/**
 * The page's totals. `lines` are the period's; `movements` may reach past
 * it (the manual match offers a wider window), so only those dated inside
 * [from, to] count as the period's unmatched book movements. The statement
 * balance is the last line with a balance (by date, then file order), the
 * book balance comes from the account's opening balance and movements.
 */
export function summarize(input: {
  lines: readonly StatementLine[];
  movements: readonly BookMovement[];
  from: string;
  to: string;
  bookBalance: number;
}): ReconciliationSummary {
  const by = (status: StatementLine["status"]) =>
    input.lines.filter((l) => l.status === status);
  const matched = by("matched");
  const open = by("open");
  const ignored = by("ignored");
  const withBalance = input.lines.filter((l) => l.balance !== null);
  const last = withBalance[withBalance.length - 1];
  const unmatched = input.movements.filter(
    (m) =>
      m.line_ids.length === 0 &&
      m.transaction_date >= input.from &&
      m.transaction_date <= input.to,
  );
  const statementBalance = last?.balance ?? null;
  return {
    statement_balance: statementBalance,
    statement_balance_date: last?.line_date ?? null,
    book_balance: input.bookBalance,
    difference:
      statementBalance === null
        ? null
        : sumAmounts([statementBalance, -input.bookBalance]),
    matched_count: matched.length,
    matched_total: sumAmounts(matched.map((l) => l.amount)),
    open_count: open.length,
    open_total: sumAmounts(open.map((l) => l.amount)),
    ignored_count: ignored.length,
    ignored_total: sumAmounts(ignored.map((l) => l.amount)),
    unmatched_book_count: unmatched.length,
    unmatched_book_total: sumAmounts(unmatched.map((m) => m.signed_amount)),
  };
}
