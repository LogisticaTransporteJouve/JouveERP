"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { useListParams } from "@/hooks/use-list-params";
import {
  parsePeriodParams,
  resolvePeriod,
  type PeriodSelection,
  type ResolvedPeriod,
} from "@/lib/list-period";

type PeriodParams = { period: PeriodSelection };

const ALL_DATES: PeriodParams = {
  period: { preset: null, from: null, to: null },
};

function periodToUrl(params: PeriodParams): Record<string, string | null> {
  return {
    period: params.period.preset,
    from: params.period.from,
    to: params.period.to,
  };
}

/**
 * A screen's date period as the URL carries it (`period`, `from`, `to`), for
 * views that filter rows they already hold (account statements). Defaults to
 * every date; `reset` goes back to it.
 */
export function useUrlPeriod(): {
  period: PeriodSelection;
  range: ResolvedPeriod | null;
  setPeriod: (period: PeriodSelection) => void;
  reset: () => void;
  isFiltered: boolean;
} {
  const searchParams = useSearchParams();
  const [initial] = useState<PeriodParams>(() => ({
    period: parsePeriodParams({
      period: searchParams.get("period"),
      from: searchParams.get("from"),
      to: searchParams.get("to"),
    }),
  }));
  const { params, update, reset, isFiltered } = useListParams({
    initial,
    defaults: ALL_DATES,
    toUrl: periodToUrl,
  });
  return {
    period: params.period,
    range: resolvePeriod(params.period),
    setPeriod: (period) => update({ period }),
    reset,
    isFiltered,
  };
}
