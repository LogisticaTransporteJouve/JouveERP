import { AR_OFFSET_MS } from "@/lib/format";

import type { WorkflowSchedule } from "./schema";

// Buenos Aires wall-clock time is a fixed UTC-3 (no DST since 2009), so no
// time zone database is needed.
const OFFSET_MS = -AR_OFFSET_MS;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar parts of `instant` on the Buenos Aires wall clock. */
export function arLocalParts(instant: Date): {
  year: number;
  month: number;
  day: number;
  isoWeekday: number;
} {
  const local = new Date(instant.getTime() + OFFSET_MS);
  const weekday = local.getUTCDay();
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    isoWeekday: weekday === 0 ? 7 : weekday,
  };
}

/** The instant of a Buenos Aires wall-clock date and time. */
export function arInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - OFFSET_MS);
}

/**
 * The first occurrence of `schedule` strictly after `after`. Occurrences are
 * Buenos Aires wall-clock times; a run that is due is claimed by the
 * 15-minute cron, which then asks for the next one after "now", so missed
 * occurrences collapse into one run instead of piling up.
 */
export function nextRunAt(schedule: WorkflowSchedule, after: Date): Date {
  const today = arLocalParts(after);
  const at = (y: number, m: number, d: number) =>
    arInstant(y, m, d, schedule.runHour, schedule.runMinute);

  if (schedule.cadence === "monthly") {
    const day = schedule.monthDay ?? 1;
    const thisMonth = at(today.year, today.month, day);
    if (thisMonth.getTime() > after.getTime()) return thisMonth;
    const nextMonth = today.month === 12 ? 1 : today.month + 1;
    const nextYear = today.month === 12 ? today.year + 1 : today.year;
    return at(nextYear, nextMonth, day);
  }

  const todayAt = at(today.year, today.month, today.day);
  if (schedule.cadence === "weekly") {
    const target = schedule.weekday ?? 1;
    let ahead = (target - today.isoWeekday + 7) % 7;
    if (ahead === 0 && todayAt.getTime() <= after.getTime()) ahead = 7;
    return new Date(todayAt.getTime() + ahead * DAY_MS);
  }

  return todayAt.getTime() > after.getTime()
    ? todayAt
    : new Date(todayAt.getTime() + DAY_MS);
}

/** Monday (YYYY-MM-DD) of the Buenos Aires week that contains `instant`. */
export function arWeekStart(instant: Date): string {
  const { year, month, day, isoWeekday } = arLocalParts(instant);
  const monday = new Date(Date.UTC(year, month - 1, day - (isoWeekday - 1)));
  return monday.toISOString().slice(0, 10);
}

/** YYYY-MM of the Buenos Aires month before the one containing `instant`. */
export function arPreviousPeriod(instant: Date): string {
  const { year, month } = arLocalParts(instant);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
}

/** YYYY-MM-DD on the Buenos Aires calendar. */
export function arDate(instant: Date): string {
  const { year, month, day } = arLocalParts(instant);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
