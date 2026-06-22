"use client";

import { useQuery } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import { getFleetProfitabilityAction } from "../actions/profitability-actions";
import { fleetReportsKeys } from "../lib/fleet-reports-keys";

export function useFleetProfitability(periodStart: string, periodEnd: string) {
  return useQuery({
    queryKey: fleetReportsKeys.profitability(periodStart, periodEnd),
    queryFn: () =>
      runAction(() => getFleetProfitabilityAction({ periodStart, periodEnd })),
    enabled: Boolean(periodStart) && Boolean(periodEnd),
  });
}
