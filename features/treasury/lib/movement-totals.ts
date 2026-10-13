// Pure mapping of the treasury aggregate RPCs (account_movement_totals,
// transaction_monthly_flows) into what the treasury summary and the cash-flow
// builder consume. The sums run in Postgres; this only indexes / converts.

import type { CashFlowEvent, CashScope } from "./cash-flow";

export type MovementTotalsRow = {
  account_id: string;
  net_until: number | string;
  net_until_split: number | string;
  last_movement_date: string | null;
};

export type AccountMovementTotals = {
  /** Σ signed movements up to the "until" date. */
  netUntil: number;
  /** Σ signed movements up to the "split" date (e.g. previous month end). */
  netUntilSplit: number;
  lastMovementDate: string | null;
};

/** Indexes the RPC rows by account. Accounts with no movement are absent
 *  (callers default them to zero). */
export function indexMovementTotals(
  rows: readonly MovementTotalsRow[],
): Map<string, AccountMovementTotals> {
  const out = new Map<string, AccountMovementTotals>();
  for (const r of rows) {
    out.set(r.account_id, {
      netUntil: Number(r.net_until),
      netUntilSplit: Number(r.net_until_split),
      lastMovementDate: r.last_movement_date,
    });
  }
  return out;
}

export type MonthlyFlowRow = {
  account_id: string;
  /** YYYY-MM */
  month: string;
  kind: string;
  scope: string;
  total: number | string;
};

export function isCashScope(value: string): value is CashScope {
  return value === "facturado" || value === "interno" || value === "otro";
}

/**
 * Realized cash-flow events from per account × month × kind × scope totals.
 * Only accounts present in `accountCurrency` count (USD accounts without a
 * loaded rate are left out, as the caller decided), only income/expense kinds,
 * only months shown in the chart. Amounts are converted to ARS with the
 * account's currency.
 */
export function monthlyFlowsToEvents(
  rows: readonly MonthlyFlowRow[],
  opts: {
    accountCurrency: ReadonlyMap<string, string>;
    toArs: (amount: number, currency: string) => number | null;
    monthSet: ReadonlySet<string>;
  },
): CashFlowEvent[] {
  const events: CashFlowEvent[] = [];
  for (const r of rows) {
    const currency = opts.accountCurrency.get(r.account_id);
    if (currency === undefined) continue;
    if (r.kind !== "income" && r.kind !== "expense") continue;
    if (!opts.monthSet.has(r.month)) continue;
    const amount = opts.toArs(Number(r.total), currency);
    if (amount === null) continue;
    events.push({
      month: r.month,
      direction: r.kind === "income" ? "in" : "out",
      amount: Math.abs(amount),
      scope: isCashScope(r.scope) ? r.scope : "otro",
    });
  }
  return events;
}
