"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  listInsightsAction,
  runAnalystAction,
  setInsightStatusAction,
} from "../actions";
import { insightsKeys } from "../lib/insights-keys";

export function useInsights() {
  return useQuery({
    queryKey: insightsKeys.list(),
    queryFn: () => runAction(() => listInsightsAction()),
    staleTime: 5 * 60_000,
  });
}

export function useSetInsightStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; status: "acknowledged" | "dismissed" }) =>
      runAction(() => setInsightStatusAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: insightsKeys.list() });
    },
  });
}

export function useRunAnalyst() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => runAction(() => runAnalystAction()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: insightsKeys.list() });
    },
  });
}
