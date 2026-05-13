/**
 * Global date-range filter for the dashboard. Lives in the topbar next to
 * the scope selector so every list/feed can subscribe to it without
 * re-implementing the same "Mes actual / 3 meses / 6 meses / año / todo /
 * personalizado" picker.
 *
 * Default = `current_month`. The choice persists in localStorage.
 */

export type RangePreset =
  | "current_month"
  | "last_3_months"
  | "last_6_months"
  | "last_year"
  | "all"
  | "custom";

export const RANGE_PRESET_OPTIONS: Array<{
  value: RangePreset;
  label: string;
}> = [
  { value: "current_month", label: "Mes actual" },
  { value: "last_3_months", label: "Últimos 3 meses" },
  { value: "last_6_months", label: "Últimos 6 meses" },
  { value: "last_year", label: "Último año" },
  { value: "all", label: "Todo" },
  { value: "custom", label: "Personalizado" },
];

export const RANGE_PRESET_LABEL: Record<RangePreset, string> =
  Object.fromEntries(
    RANGE_PRESET_OPTIONS.map((o) => [o.value, o.label]),
  ) as Record<RangePreset, string>;

export interface DateRange {
  from: string; // ISO date (YYYY-MM-DD)
  to: string; // ISO date (YYYY-MM-DD)
}

function todayIsoLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function firstOfMonthIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function monthsBackIso(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Resolve a preset (or a custom range) to a concrete `{from, to}` window.
 * Returns null for `all` — meaning "no filter".
 */
export function resolveRange(
  preset: RangePreset,
  custom: { from: string; to: string } | null,
): DateRange | null {
  const to = todayIsoLocal();
  switch (preset) {
    case "current_month":
      return { from: firstOfMonthIso(), to };
    case "last_3_months":
      return { from: monthsBackIso(3), to };
    case "last_6_months":
      return { from: monthsBackIso(6), to };
    case "last_year":
      return { from: monthsBackIso(12), to };
    case "all":
      return null;
    case "custom":
      if (!custom || !custom.from || !custom.to) return null;
      return { from: custom.from, to: custom.to };
  }
}

export function isRangePreset(value: unknown): value is RangePreset {
  return (
    typeof value === "string" &&
    RANGE_PRESET_OPTIONS.some((o) => o.value === value)
  );
}
