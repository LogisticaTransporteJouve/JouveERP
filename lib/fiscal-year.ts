// The company's fiscal year runs October to September. A fiscal year is named
// by the calendar year it ends in: FY 2026 = 2025-10 … 2026-09.

const FIRST_MONTH = 10;

function parsePeriod(period: string): { year: number; month: number } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) throw new Error(`Invalid period: ${period}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

function toPeriod(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** The fiscal year (by its ending calendar year) a `YYYY-MM` period is in. */
export function fiscalYearOf(period: string): number {
  const { year, month } = parsePeriod(period);
  return month >= FIRST_MONTH ? year + 1 : year;
}

/** First month (`YYYY-MM`) of the fiscal year a period is in. */
export function fiscalYearStart(period: string): string {
  return toPeriod(fiscalYearOf(period) - 1, FIRST_MONTH);
}

/** The twelve `YYYY-MM` months of fiscal year `fy`, October first. */
export function fiscalYearMonths(fy: number): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const offset = FIRST_MONTH - 1 + i;
    return toPeriod(fy - 1 + Math.floor(offset / 12), (offset % 12) + 1);
  });
}

/** "2025/26" for FY 2026. */
export function fiscalYearLabel(fy: number): string {
  return `${fy - 1}/${String(fy).slice(-2)}`;
}
