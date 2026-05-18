"use client";

import { useQuery } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import { getTreasurySummaryAction } from "../actions/treasury-actions";
import { treasuryKeys } from "../lib/treasury-keys";

export function useTreasurySummary() {
  return useQuery({
    queryKey: treasuryKeys.summary(),
    queryFn: () => runAction(() => getTreasurySummaryAction()),
    staleTime: 30_000,
  });
}
