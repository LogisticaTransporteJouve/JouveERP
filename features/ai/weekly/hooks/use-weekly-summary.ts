"use client";

import { useQuery } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import { workflowsKeys } from "../../workflows/lib/workflows-keys";
import { getWeeklySummaryAction } from "../actions";

export function useWeeklySummary() {
  return useQuery({
    queryKey: workflowsKeys.weeklySummary(),
    queryFn: () => runAction(() => getWeeklySummaryAction()),
    staleTime: 10 * 60_000,
  });
}
