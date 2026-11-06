import { addDaysIso } from "@/lib/date-range";
import { formatArgentineDate } from "@/lib/format";

// Leave arithmetic shared by the leaves form, the assistant's leave proposal
// and its leaves read. Leaves count calendar days (end − start + 1), as
// employee_leaves.days does.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function utcDay(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
}

/** Calendar days of a leave, both ends included. */
export function leaveDays(start: string, end: string): number {
  return Math.round(utcDay(end) - utcDay(start)) + 1;
}

/** Calendar days of [start, end] that fall inside [from, to]; 0 when they
 *  do not overlap. */
export function leaveDaysInRange(
  leave: { start_date: string; end_date: string },
  from: string,
  to: string,
): number {
  const start = leave.start_date > from ? leave.start_date : from;
  const end = leave.end_date < to ? leave.end_date : to;
  return end < start ? 0 : leaveDays(start, end);
}

/** Monday = 0 … Sunday = 6. */
function weekdayIndex(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

const WEEKDAY_NAMES = [
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
  "domingo",
] as const;

/** The holidays a start-date check may need for a leave starting in `year`:
 *  that year plus the edge weeks of the years around it. */
export function holidayWindow(year: number): { from: string; to: string } {
  return { from: `${year - 1}-12-01`, to: `${year + 1}-01-31` };
}

/**
 * LCT art. 151: vacations start on a Monday, or on the next working day when
 * that Monday is a holiday. Null when `start` is that day for its week;
 * otherwise the warning to show. A warning, not a block: an agreement can
 * set another start.
 */
export function vacationStartWarning(
  start: string,
  holidays: ReadonlySet<string>,
): string | null {
  let expected = addDaysIso(start, -weekdayIndex(start));
  while (weekdayIndex(expected) >= 5 || holidays.has(expected)) {
    expected = addDaysIso(expected, 1);
  }
  if (expected === start) return null;
  const named = (iso: string) =>
    `${WEEKDAY_NAMES[weekdayIndex(iso)]} ${formatArgentineDate(iso)}`;
  const holiday = holidays.has(start) ? " (feriado)" : "";
  return (
    `Empieza el ${named(start)}${holiday}: por la LCT (art. 151) las ` +
    "vacaciones empiezan un lunes, o el día hábil siguiente si el lunes es " +
    `feriado; esa semana sería el ${named(expected)}.`
  );
}

/** A vacation balance row as the pending figure reads it. */
export type PendingBalanceRow = {
  period_year: number | null;
  remaining_days: number | null;
  status: string | null;
};

/**
 * The days an employee has pending as of `periodYear`, as Personal →
 * Vacaciones shows them: the current period's balance plus what is still
 * positive in earlier periods kept open. Null when no open balance is
 * loaded (unknown, not zero).
 */
export function pendingVacationDays(
  balances: readonly PendingBalanceRow[],
  periodYear: number,
): number | null {
  const open = balances.filter(
    (b) =>
      b.period_year !== null &&
      b.period_year <= periodYear &&
      (b.status === "active" || b.status === "extended"),
  );
  if (open.length === 0) return null;
  return open.reduce(
    (sum, b) =>
      sum +
      (b.period_year === periodYear
        ? (b.remaining_days ?? 0)
        : Math.max(b.remaining_days ?? 0, 0)),
    0,
  );
}

/** Warning when a vacation leave takes more days than are pending. */
export function vacationBalanceWarning(
  start: string,
  end: string,
  pending: number | null,
): string | null {
  if (pending === null) {
    return "No tiene saldo de vacaciones cargado: no se puede comparar con los días pendientes.";
  }
  const days = leaveDays(start, end);
  if (days <= pending) return null;
  const count = (n: number) => `${n} ${n === 1 ? "día" : "días"}`;
  return `La licencia es de ${count(days)} y le quedan ${count(pending)} de vacaciones pendientes.`;
}

/** What the start-date and balance checks need. `pending` undefined = the
 *  balance could not be read (no balance warning is shown for it). */
export type LeaveWarningContext = {
  holidays: ReadonlySet<string>;
  pending: number | null | undefined;
};

/** The warnings for a leave about to be saved: only vacations have them. */
export function leaveWarnings(
  leave: { kind: string; start_date: string; end_date: string },
  context: LeaveWarningContext,
): string[] {
  // A half-typed date gives no warning yet (the form validates it on save).
  if (
    leave.kind !== "vacaciones" ||
    !ISO_DATE.test(leave.start_date) ||
    !ISO_DATE.test(leave.end_date) ||
    leave.end_date < leave.start_date
  ) {
    return [];
  }
  const warnings = [vacationStartWarning(leave.start_date, context.holidays)];
  if (context.pending !== undefined) {
    warnings.push(
      vacationBalanceWarning(leave.start_date, leave.end_date, context.pending),
    );
  }
  return warnings.filter((w): w is string => w !== null);
}
