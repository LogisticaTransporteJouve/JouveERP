// Deterministic cash-flow projection (no LLM). Combines a starting cash
// balance with dated inflows/outflows into weekly running balances and flags
// the first week the balance goes negative. docs/ai-overview.md §5 (insight #1).

export type CashEvent = {
  /** YYYY-MM-DD. */
  date: string;
  /** Positive = inflow, negative = outflow. */
  amount: number;
  label: string;
};

export type WeekBucket = {
  weekStart: string;
  net: number;
  closing: number;
};

export type CashFlowProjection = {
  startingBalance: number;
  weeks: WeekBucket[];
  deficit: { weekStart: string; closing: number } | null;
  totalIn: number;
  totalOut: number;
  lowestClosing: number;
};

export type Frequency = "weekly" | "monthly" | "quarterly" | "yearly";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function advance(date: string, frequency: Frequency): string {
  const d = new Date(`${date}T00:00:00Z`);
  switch (frequency) {
    case "weekly":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "monthly":
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case "quarterly":
      d.setUTCMonth(d.getUTCMonth() + 3);
      break;
    case "yearly":
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Projects cash forward over `weeks` weekly buckets from `fromDate`. Events
 * outside the horizon are ignored. The deficit is the first bucket whose
 * running closing balance is negative.
 */
export function projectCashFlow(input: {
  startingBalance: number;
  events: CashEvent[];
  fromDate: string;
  weeks: number;
}): CashFlowProjection {
  const buckets: WeekBucket[] = [];
  let closing = input.startingBalance;
  let lowestClosing = input.startingBalance;
  let totalIn = 0;
  let totalOut = 0;

  for (let i = 0; i < input.weeks; i++) {
    const weekStart = addDays(input.fromDate, i * 7);
    const weekEnd = addDays(input.fromDate, (i + 1) * 7);
    let net = 0;
    for (const event of input.events) {
      if (event.date >= weekStart && event.date < weekEnd) {
        net += event.amount;
        if (event.amount >= 0) totalIn += event.amount;
        else totalOut += event.amount;
      }
    }
    closing = round2(closing + net);
    if (closing < lowestClosing) lowestClosing = closing;
    buckets.push({ weekStart, net: round2(net), closing });
  }

  const deficitBucket = buckets.find((b) => b.closing < 0) ?? null;
  return {
    startingBalance: round2(input.startingBalance),
    weeks: buckets,
    deficit: deficitBucket
      ? { weekStart: deficitBucket.weekStart, closing: deficitBucket.closing }
      : null,
    totalIn: round2(totalIn),
    totalOut: round2(totalOut),
    lowestClosing: round2(lowestClosing),
  };
}

/**
 * Expands a recurring payment into the outflow events that fall within
 * [fromDate, toDate). Walks from `nextDueDate` by `frequency`, skipping
 * occurrences past `endDate`.
 */
export function expandRecurringPayment(input: {
  nextDueDate: string;
  frequency: Frequency;
  endDate: string | null;
  amount: number;
  fromDate: string;
  toDate: string;
  label: string;
}): CashEvent[] {
  const events: CashEvent[] = [];
  let due = input.nextDueDate;
  let guard = 0;

  while (due < input.fromDate && guard < 1000) {
    due = advance(due, input.frequency);
    guard += 1;
  }
  while (due < input.toDate && guard < 1000) {
    if (input.endDate && due > input.endDate) break;
    events.push({
      date: due,
      amount: -Math.abs(input.amount),
      label: input.label,
    });
    due = advance(due, input.frequency);
    guard += 1;
  }
  return events;
}
