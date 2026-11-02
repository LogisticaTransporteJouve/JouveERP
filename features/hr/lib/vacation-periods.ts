// Vacation periods under the LCT: a period N is granted on October 1 of year
// N and is taken between that day and April 30 of N+1 (art. 154). Its days
// depend on the seniority reached on December 31 of N (art. 150). Mirrors
// public.grant_vacation_balances, which writes the same rows on October 1.

/** Period year that covers `today` (yyyy-mm-dd): from October 1 it is the
 *  current year; before that, the previous one. */
export function currentVacationPeriodYear(today: string): number {
  const year = Number(today.slice(0, 4));
  return today.slice(5) >= "10-01" ? year : year - 1;
}

/** Dates of a period's balance row, as grant_vacation_balances writes them. */
export function vacationPeriodWindow(periodYear: number): {
  granted_at: string;
  expires_at: string;
} {
  return {
    granted_at: `${periodYear}-10-01`,
    expires_at: `${periodYear + 1}-04-30`,
  };
}

/** Days the LCT grants for a full period (art. 150), by seniority on
 *  December 31 of the period. A suggestion: art. 153 prorating for short
 *  service and agreed extra days are entered by hand. */
export function suggestedVacationDays(
  hireDate: string,
  periodYear: number,
): number {
  const hireYear = Number(hireDate.slice(0, 4));
  const years = periodYear - hireYear;
  if (years < 5) return 14;
  if (years < 10) return 21;
  if (years < 20) return 28;
  return 35;
}
