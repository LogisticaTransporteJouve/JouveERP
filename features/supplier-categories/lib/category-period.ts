import { todayInAR } from "@/lib/format";
import {
  parsePeriodParams,
  resolvePeriod,
  type PeriodSelection,
  type ResolvedPeriod,
} from "@/lib/list-period";

// The category page opens on the current year, unlike the lists (every date),
// so "Todas las fechas" needs its own URL value to survive a reload.
const ALL_DATES_PARAM = "all";

export const DEFAULT_CATEGORY_PERIOD: PeriodSelection = {
  preset: "this_year",
  from: null,
  to: null,
};

/** The spend RPCs take a closed range: every date is the widest one. */
const ALL_DATES_RANGE: ResolvedPeriod = {
  from: "1900-01-01",
  to: "9999-12-31",
};

export function parseCategoryPeriodParams(params: {
  period?: string | null;
  from?: string | null;
  to?: string | null;
}): PeriodSelection {
  if (params.period === ALL_DATES_PARAM) {
    return { preset: null, from: null, to: null };
  }
  if (!params.period && !params.from && !params.to) {
    return DEFAULT_CATEGORY_PERIOD;
  }
  const parsed = parsePeriodParams(params);
  return parsed.preset === null ? DEFAULT_CATEGORY_PERIOD : parsed;
}

export function categoryPeriodToUrl(params: {
  period: PeriodSelection;
}): Record<string, string | null> {
  return {
    period: params.period.preset ?? ALL_DATES_PARAM,
    from: params.period.from,
    to: params.period.to,
  };
}

export function categoryPeriodRange(
  selection: PeriodSelection,
  today: string = todayInAR(),
): ResolvedPeriod {
  return resolvePeriod(selection, today) ?? ALL_DATES_RANGE;
}
