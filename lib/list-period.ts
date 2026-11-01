/**
 * Date-period filter and grouping shared by every list and account statement.
 * The choice lives in each screen's URL (`period`, `from`, `to`, `group`), so a filtered
 * view can be shared or reloaded. Presets resolve against today's date in
 * Argentina, on the server prefetch and in the browser alike.
 */

import { todayInAR } from "@/lib/format";

export const PERIOD_PRESETS = [
  "today",
  "yesterday",
  "this_week",
  "this_month",
  "last_month",
  "this_year",
  "last_year",
  "custom",
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_PRESET_LABEL: Record<PeriodPreset, string> = {
  today: "Hoy",
  yesterday: "Ayer",
  this_week: "Esta semana",
  this_month: "Este mes",
  last_month: "Mes anterior",
  this_year: "Este año",
  last_year: "Año anterior",
  custom: "Personalizado",
};

/** No `period` param: every date. */
export const ALL_DATES_LABEL = "Todas las fechas";

export const LIST_GROUPS = ["day", "week", "month"] as const;
export type ListGroup = (typeof LIST_GROUPS)[number];

export const LIST_GROUP_LABEL: Record<ListGroup, string> = {
  day: "Por día",
  week: "Por semana",
  month: "Por mes",
};

/** The period as the URL carries it. `from`/`to` only matter for `custom`. */
export interface PeriodSelection {
  preset: PeriodPreset | null;
  from: string | null;
  to: string | null;
}

export interface ResolvedPeriod {
  from: string;
  to: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isPeriodPreset(value: unknown): value is PeriodPreset {
  return (
    typeof value === "string" &&
    (PERIOD_PRESETS as readonly string[]).includes(value)
  );
}

export function isListGroup(value: unknown): value is ListGroup {
  return (
    typeof value === "string" &&
    (LIST_GROUPS as readonly string[]).includes(value)
  );
}

/** Lists open grouped by day; "Lista" (no grouping) is the `none` param. */
export const DEFAULT_LIST_GROUP: ListGroup = "day";
const NO_GROUP_PARAM = "none";

export function parseListGroupParam(
  value: string | null | undefined,
): ListGroup | null {
  if (value === NO_GROUP_PARAM) return null;
  return isListGroup(value) ? value : DEFAULT_LIST_GROUP;
}

/** The `group` URL param for a grouping (null: the default, omitted). */
export function listGroupParam(group: ListGroup | null): string | null {
  if (group === null) return NO_GROUP_PARAM;
  return group === DEFAULT_LIST_GROUP ? null : group;
}

function asIsoDate(value: string | null | undefined): string | null {
  return value && ISO_DATE.test(value) ? value : null;
}

export function parsePeriodParams(params: {
  period?: string | null;
  from?: string | null;
  to?: string | null;
}): PeriodSelection {
  const from = asIsoDate(params.from);
  const to = asIsoDate(params.to);
  // A bare from/to pair (links from before presets existed) is a custom range.
  const preset = isPeriodPreset(params.period)
    ? params.period
    : from && to
      ? "custom"
      : null;
  if (preset !== "custom") return { preset, from: null, to: null };
  if (!from || !to) return { preset: null, from: null, to: null };
  return from <= to ? { preset, from, to } : { preset, from: to, to: from };
}

// Calendar math on plain dates, in UTC so no local offset shifts a day.
function toUtc(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** Monday of the ISO week holding `iso` (Postgres `date_trunc('week')`). */
export function startOfWeek(iso: string): string {
  const weekday = (toUtc(iso).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(iso, -weekday);
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** The `[from, to]` a selection filters on; null = every date. */
export function resolvePeriod(
  selection: PeriodSelection,
  today: string = todayInAR(),
): ResolvedPeriod | null {
  switch (selection.preset) {
    case null:
      return null;
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const yesterday = addDays(today, -1);
      return { from: yesterday, to: yesterday };
    }
    case "this_week":
      return { from: startOfWeek(today), to: today };
    case "this_month":
      return { from: startOfMonth(today), to: today };
    case "last_month": {
      const lastMonth = addDays(startOfMonth(today), -1);
      return { from: startOfMonth(lastMonth), to: lastMonth };
    }
    case "this_year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "last_year": {
      const year = Number(today.slice(0, 4)) - 1;
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    }
    case "custom":
      return selection.from && selection.to
        ? { from: selection.from, to: selection.to }
        : null;
  }
}

/** The bucket (first day) a document date falls in, matching the totals RPCs. */
export function bucketOf(iso: string, group: ListGroup): string {
  switch (group) {
    case "day":
      return iso;
    case "week":
      return startOfWeek(iso);
    case "month":
      return startOfMonth(iso);
  }
}

const WEEKDAYS_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS_LONG_ES = [
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
];

function dmy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** "lun 28/10/2026", "Semana del 26/10/2026 al 01/11/2026", "octubre 2026". */
export function formatBucket(bucket: string, group: ListGroup): string {
  switch (group) {
    case "day":
      return `${WEEKDAYS_ES[toUtc(bucket).getUTCDay()]} ${dmy(bucket)}`;
    case "week":
      return `Semana del ${dmy(bucket)} al ${dmy(addDays(bucket, 6))}`;
    case "month": {
      const month = MONTHS_LONG_ES[Number(bucket.slice(5, 7)) - 1] ?? "";
      return `${month} ${bucket.slice(0, 4)}`;
    }
  }
}
