"use client";

import { useQuery } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import { getCashFlowAction } from "../actions/cash-flow-actions";
import { getTreasurySummaryAction } from "../actions/treasury-actions";
import { treasuryKeys } from "../lib/treasury-keys";

export function useTreasurySummary() {
  return useQuery({
    queryKey: treasuryKeys.summary(),
    queryFn: () => runAction(() => getTreasurySummaryAction()),
    staleTime: 30_000,
  });
}

export function useCashFlow(monthsBack: number, monthsFwd: number) {
  return useQuery({
    queryKey: treasuryKeys.cashFlow(monthsBack, monthsFwd),
    queryFn: () => runAction(() => getCashFlowAction({ monthsBack, monthsFwd })),
    staleTime: 30_000,
  });
}
