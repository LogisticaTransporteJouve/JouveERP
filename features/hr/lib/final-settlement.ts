import { suggestedVacationDays } from "./vacation-periods";

// Final settlement (liquidación final) suggested when an employee leaves:
// the days worked in the last month, the unused vacation days (pending
// balances plus the proportional of the leaving year, LCT art. 156) and,
// apart, the proportional SAC (payroll_sac_suggestion). Every figure is a
// suggestion the planilla keeps editable.

export type FinalSettlementBasis = {
  /** yyyy-mm-dd */
  terminationDate: string;
  /** yyyy-mm-dd */
  hireDate: string;
  monthlySalary: number;
  /** Days left on the employee's active vacation balances. */
  pendingVacationDays: number;
  /** A balance for the leaving year was already granted (October 1). */
  hasBalanceForTerminationYear: boolean;
};

export type FinalSettlement = {
  daysWorked: number;
  proratedSalary: number;
  vacationDays: number;
  vacationAmount: number;
};

const DAY_MS = 86_400_000;

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function utc(date: string): number {
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
}

export function finalSettlement(b: FinalSettlementBasis): FinalSettlement {
  const salary = Math.max(b.monthlySalary, 0);
  // A month counts as 30 days; the 31st adds nothing. Hired that same
  // month, the days before the hire date were not worked.
  const lastDay = Math.min(Number(b.terminationDate.slice(8, 10)), 30);
  const hiredThatMonth =
    b.hireDate.slice(0, 7) === b.terminationDate.slice(0, 7);
  const firstDay = hiredThatMonth
    ? Math.min(Number(b.hireDate.slice(8, 10)), 30)
    : 1;
  const daysWorked = Math.max(lastDay - firstDay + 1, 0);
  const proratedSalary = round((salary / 30) * daysWorked, 2);

  const year = Number(b.terminationDate.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const from = b.hireDate > yearStart ? b.hireDate : yearStart;
  const daysInYear = Math.max(
    (utc(b.terminationDate) - utc(from)) / DAY_MS + 1,
    0,
  );
  const proportional = b.hasBalanceForTerminationYear
    ? 0
    : (suggestedVacationDays(b.hireDate, year) * daysInYear) / 365;
  const vacationDays = round(
    Math.max(b.pendingVacationDays, 0) + proportional,
    1,
  );
  // LCT art. 155: a vacation day of a monthly salary is 1/25 of it.
  const vacationAmount = round((salary / 25) * vacationDays, 2);

  return { daysWorked, proratedSalary, vacationDays, vacationAmount };
}

/** The proportional SAC still owed on leaving: the half's SAC planilla
 *  already pays what its entry holds (filled while the employee was active),
 *  so only the rest goes into the final settlement. */
export function sacStillOwed(
  suggested: number,
  alreadyInSacPlanilla: number,
): number {
  return round(Math.max(suggested - Math.max(alreadyInSacPlanilla, 0), 0), 2);
}
