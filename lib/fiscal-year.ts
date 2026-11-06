// The company's fiscal year (ejercicio) starts in a configurable month
// (accounting_settings.fiscal_year_start_month; Jouve: October). A fiscal year
// is named by the calendar year it ends in: with October, FY 2026 = 2025-10 …
// 2026-09; with January, FY 2026 = 2026-01 … 2026-12.

/** The start month before the owner changes it (Jouve's ejercicio). */
export const DEFAULT_FISCAL_YEAR_START_MONTH = 10;

const MONTH_ABBR = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/** "Octubre" for 10. */
export function monthName(month: number): string {
  assertStartMonth(month);
  const name = MONTH_NAMES[month - 1]!;
  return name[0]!.toUpperCase() + name.slice(1);
}

function parsePeriod(period: string): { year: number; month: number } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) throw new Error(`Invalid period: ${period}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

function assertStartMonth(startMonth: number): void {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new Error(`Invalid fiscal year start month: ${startMonth}`);
  }
}

function toPeriod(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** The fiscal year (by its ending calendar year) a `YYYY-MM` period is in. */
export function fiscalYearOf(period: string, startMonth: number): number {
  assertStartMonth(startMonth);
  const { year, month } = parsePeriod(period);
  return startMonth > 1 && month >= startMonth ? year + 1 : year;
}

/** The twelve `YYYY-MM` months of fiscal year `fy`, its first month first. */
export function fiscalYearMonths(fy: number, startMonth: number): string[] {
  assertStartMonth(startMonth);
  const firstYear = startMonth > 1 ? fy - 1 : fy;
  return Array.from({ length: 12 }, (_, i) => {
    const offset = startMonth - 1 + i;
    return toPeriod(firstYear + Math.floor(offset / 12), (offset % 12) + 1);
  });
}

/** First month (`YYYY-MM`) of the fiscal year a period is in. */
export function fiscalYearStart(period: string, startMonth: number): string {
  return fiscalYearMonths(fiscalYearOf(period, startMonth), startMonth)[0]!;
}

/** Last day (`YYYY-MM-DD`) of a `YYYY-MM` period. */
export function periodEnd(period: string): string {
  const { year, month } = parsePeriod(period);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${period}-${String(last).padStart(2, "0")}`;
}

/** "2025/26" for FY 2026 starting in October; "2026" when it is the
 *  calendar year. */
export function fiscalYearLabel(fy: number, startMonth: number): string {
  assertStartMonth(startMonth);
  return startMonth === 1 ? String(fy) : `${fy - 1}/${String(fy).slice(-2)}`;
}

/** "oct 2025" for `2025-10`. */
export function shortPeriodLabel(period: string): string {
  const { year, month } = parsePeriod(period);
  return `${MONTH_ABBR[month - 1]} ${year}`;
}

/** "oct–sep" for October; "ene–dic" for January. */
export function fiscalYearMonthsLabel(startMonth: number): string {
  assertStartMonth(startMonth);
  const last = ((startMonth + 10) % 12) + 1;
  return `${MONTH_ABBR[startMonth - 1]}–${MONTH_ABBR[last - 1]}`;
}

/** The Balance screen's presets: the current fiscal year up to `today`'s
 *  month, and the whole previous one. */
export function fiscalYearPresets(
  todayPeriod: string,
  startMonth: number,
): {
  current: { from: string; to: string; fy: number };
  previous: { from: string; to: string; fy: number };
} {
  const fy = fiscalYearOf(todayPeriod, startMonth);
  const previous = fiscalYearMonths(fy - 1, startMonth);
  return {
    current: {
      from: fiscalYearStart(todayPeriod, startMonth),
      to: todayPeriod,
      fy,
    },
    previous: { from: previous[0]!, to: previous[11]!, fy: fy - 1 },
  };
}
