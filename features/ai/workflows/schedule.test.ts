import { describe, expect, it } from "vitest";

import {
  arDate,
  arInstant,
  arLocalParts,
  arPreviousPeriod,
  arWeekStart,
  nextRunAt,
} from "./schedule";
import type { WorkflowSchedule } from "./schema";

const daily: WorkflowSchedule = {
  cadence: "daily",
  runHour: 8,
  runMinute: 0,
  weekday: null,
  monthDay: null,
};
const mondays: WorkflowSchedule = { ...daily, cadence: "weekly", weekday: 1 };
const fifth: WorkflowSchedule = { ...daily, cadence: "monthly", monthDay: 5 };

const iso = (d: Date) => d.toISOString();

describe("Buenos Aires wall clock (UTC-3, no DST)", () => {
  it("maps local times to UTC three hours later, in every month", () => {
    expect(iso(arInstant(2026, 1, 15, 8, 0))).toBe("2026-01-15T11:00:00.000Z");
    expect(iso(arInstant(2026, 7, 15, 8, 0))).toBe("2026-07-15T11:00:00.000Z");
  });

  it("reads the local calendar day across UTC midnight", () => {
    // 02:00 UTC on Tuesday is still Monday 23:00 in Buenos Aires.
    expect(arLocalParts(new Date("2026-10-20T02:00:00Z"))).toEqual({
      year: 2026,
      month: 10,
      day: 19,
      isoWeekday: 1,
    });
  });
});

describe("nextRunAt", () => {
  it("daily: today when the time is still ahead, tomorrow otherwise", () => {
    expect(iso(nextRunAt(daily, new Date("2026-10-16T10:59:00Z")))).toBe(
      "2026-10-16T11:00:00.000Z",
    );
    expect(iso(nextRunAt(daily, new Date("2026-10-16T11:00:00Z")))).toBe(
      "2026-10-17T11:00:00.000Z",
    );
  });

  it("daily: a late-evening local time is the next UTC day", () => {
    const late = { ...daily, runHour: 22, runMinute: 30 };
    expect(iso(nextRunAt(late, new Date("2026-10-16T12:00:00Z")))).toBe(
      "2026-10-17T01:30:00.000Z",
    );
  });

  it("weekly: the next Monday 08:00 AR, strictly after", () => {
    // Friday 2026-10-16 → Monday 2026-10-19.
    expect(iso(nextRunAt(mondays, new Date("2026-10-16T12:00:00Z")))).toBe(
      "2026-10-19T11:00:00.000Z",
    );
    // Monday at 08:00 exactly → next Monday.
    expect(iso(nextRunAt(mondays, new Date("2026-10-19T11:00:00Z")))).toBe(
      "2026-10-26T11:00:00.000Z",
    );
    // Monday 07:45 AR → same day.
    expect(iso(nextRunAt(mondays, new Date("2026-10-19T10:45:00Z")))).toBe(
      "2026-10-19T11:00:00.000Z",
    );
  });

  it("weekly: Sunday night in Buenos Aires is already Monday in UTC", () => {
    const sundayLate = { ...mondays, weekday: 7, runHour: 23, runMinute: 0 };
    expect(iso(nextRunAt(sundayLate, new Date("2026-10-16T12:00:00Z")))).toBe(
      "2026-10-19T02:00:00.000Z",
    );
  });

  it("monthly: this month's day when ahead, next month's otherwise, across the year", () => {
    expect(iso(nextRunAt(fifth, new Date("2026-10-04T12:00:00Z")))).toBe(
      "2026-10-05T11:00:00.000Z",
    );
    expect(iso(nextRunAt(fifth, new Date("2026-10-16T12:00:00Z")))).toBe(
      "2026-11-05T11:00:00.000Z",
    );
    expect(iso(nextRunAt(fifth, new Date("2026-12-20T12:00:00Z")))).toBe(
      "2027-01-05T11:00:00.000Z",
    );
  });

  it("is always strictly after `after` and on the requested local time", () => {
    const start = Date.parse("2026-01-01T00:00:00Z");
    for (let i = 0; i < 400; i++) {
      const after = new Date(start + i * 7.3 * 60 * 60 * 1000);
      for (const s of [daily, mondays, fifth]) {
        const next = nextRunAt(s, after);
        expect(next.getTime()).toBeGreaterThan(after.getTime());
        const local = new Date(next.getTime() - 3 * 60 * 60 * 1000);
        expect(local.getUTCHours()).toBe(8);
        expect(local.getUTCMinutes()).toBe(0);
        if (s.cadence === "weekly") expect(local.getUTCDay()).toBe(1);
        if (s.cadence === "monthly") expect(local.getUTCDate()).toBe(5);
      }
    }
  });
});

describe("calendar helpers", () => {
  it("arWeekStart is the Buenos Aires Monday", () => {
    expect(arWeekStart(new Date("2026-10-19T11:00:00Z"))).toBe("2026-10-19");
    expect(arWeekStart(new Date("2026-10-25T23:00:00Z"))).toBe("2026-10-19");
    // Monday 01:00 UTC is still Sunday in Buenos Aires.
    expect(arWeekStart(new Date("2026-10-26T01:00:00Z"))).toBe("2026-10-19");
  });

  it("arPreviousPeriod rolls over the year", () => {
    expect(arPreviousPeriod(new Date("2026-10-19T11:00:00Z"))).toBe("2026-09");
    expect(arPreviousPeriod(new Date("2027-01-04T11:00:00Z"))).toBe("2026-12");
  });

  it("arDate uses the local day", () => {
    expect(arDate(new Date("2026-10-20T02:00:00Z"))).toBe("2026-10-19");
  });
});
