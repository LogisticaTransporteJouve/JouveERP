import { addDaysIso } from "@/lib/date-range";

import type { BuildResult } from "./build";
import type { DataRow } from "./rows";
import {
  ARTIFACT_LIMITS,
  CALENDAR_CODE_SEPARATOR,
  type ArtifactMeta,
  type ArtifactSource,
  type CalendarArtifact,
  type CalendarConfig,
} from "./spec";

type Input = { source: ArtifactSource; rows: DataRow[]; meta: ArtifactMeta };

/** The row fields a calendar reads: who, what and from/to (inclusive). */
export const CALENDAR_FIELDS = {
  label: "employee",
  key: "employee_id",
  kind: "kind",
  kindLabel: "kind_label",
  start: "start_date",
  end: "end_date",
} as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isoDate(value: unknown): string | null {
  const t = text(value);
  return t && ISO_DATE.test(t) ? t : null;
}

/** The days of a YYYY-MM month as YYYY-MM-DD. */
export function monthDays(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const count = new Date(Date.UTC(y ?? 0, m ?? 1, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => addDaysIso(`${month}-01`, i));
}

/** The month a calendar shows: the config's, else the source's `from`. */
function monthOf(
  config: CalendarConfig,
  source: ArtifactSource,
): string | null {
  if (config.month) return config.month;
  const from = isoDate(source.input.from);
  return from ? from.slice(0, 7) : null;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** One or two letters per kind: the first letter, or the first two when
 *  another kind already took it. */
function assignCodes(kinds: readonly string[]): Map<string, string> {
  const codes = new Map<string, string>();
  const taken = new Set<string>();
  for (const kind of kinds) {
    const one = kind.charAt(0).toUpperCase();
    const two = capitalize(kind.slice(0, 2));
    const code = !taken.has(one) ? one : !taken.has(two) ? two : kind;
    taken.add(code);
    codes.set(kind, code.slice(0, 2));
  }
  return codes;
}

/**
 * A month as a grid, from rows of ranges (a leave per row): one row per
 * person, one cell per day with the code of each kind that covers it. Built
 * from the rows the server loaded; the model only picks the month and the
 * title.
 */
export function buildCalendarArtifact(
  config: CalendarConfig,
  { source, rows, meta }: Input,
): BuildResult<CalendarArtifact> {
  const month = monthOf(config, source);
  if (!month) {
    return {
      ok: false,
      error: "Name the month to show (calendar.month, YYYY-MM).",
    };
  }
  const days = monthDays(month);
  const first = days[0] ?? "";
  const last = days[days.length - 1] ?? "";

  type Range = { kind: string; start: string; end: string };
  const people = new Map<string, { label: string; ranges: Range[] }>();
  const kindLabels = new Map<string, string>();
  for (const row of rows) {
    const label = text(row[CALENDAR_FIELDS.label]);
    const kind = text(row[CALENDAR_FIELDS.kind]);
    const start = isoDate(row[CALENDAR_FIELDS.start]);
    const end = isoDate(row[CALENDAR_FIELDS.end]);
    if (!label || !kind || !start || !end) {
      const f = CALENDAR_FIELDS;
      return {
        ok: false,
        error: `A calendar needs rows with ${f.label}, ${f.kind}, ${f.start} and ${f.end} (e.g. getLeavesByRange).`,
      };
    }
    if (end < first || start > last) continue;
    const key = text(row[CALENDAR_FIELDS.key]) ?? label;
    const person = people.get(key) ?? { label, ranges: [] };
    person.ranges.push({ kind, start, end });
    people.set(key, person);
    if (!kindLabels.has(kind)) {
      kindLabels.set(
        kind,
        (text(row[CALENDAR_FIELDS.kindLabel]) ?? capitalize(kind)).slice(
          0,
          ARTIFACT_LIMITS.labelLength,
        ),
      );
    }
  }
  if (people.size === 0) {
    return { ok: false, error: `Nothing falls in ${month}.` };
  }

  const kinds = [...kindLabels.keys()].slice(0, ARTIFACT_LIMITS.calendarKinds);
  const codes = assignCodes(kinds);
  const ordered = [...people.values()].sort((a, b) =>
    a.label.localeCompare(b.label, "es"),
  );
  const shown = ordered.slice(0, ARTIFACT_LIMITS.calendarRows).map((p) => ({
    label: p.label,
    cells: days.map((day) => {
      const here = new Set<string>();
      for (const r of p.ranges) {
        const code = codes.get(r.kind);
        if (code && r.start <= day && day <= r.end) here.add(code);
      }
      return [...here].join(CALENDAR_CODE_SEPARATOR);
    }),
  }));

  return {
    ok: true,
    value: {
      kind: "calendar",
      title: config.title,
      source,
      month,
      legend: kinds.map((kind) => ({
        code: codes.get(kind) ?? "",
        label: kindLabels.get(kind) ?? kind,
      })),
      rows: shown,
      truncated: ordered.length > shown.length,
      meta,
    },
  };
}
