import {
  parsePeriodParams,
  resolvePeriod,
  type PeriodSelection,
} from "@/lib/list-period";

/** A statement opens on the current month, like the account's movements. */
export const STATEMENT_DEFAULT_PERIOD: PeriodSelection = {
  preset: "this_month",
  from: null,
  to: null,
};

/** The dates a statement period covers; «Todas las fechas» is every line
 *  up to today. */
export function statementRange(
  period: PeriodSelection,
  today: string,
): { from: string; to: string } {
  return resolvePeriod(period, today) ?? { from: "2000-01-01", to: today };
}

/** The statement period a page opens on: the URL's, or the current month. */
export function statementPeriodParam(search: {
  period?: string;
  from?: string;
  to?: string;
}): PeriodSelection {
  if (!search.period && !search.from && !search.to) {
    return STATEMENT_DEFAULT_PERIOD;
  }
  return parsePeriodParams(search);
}
