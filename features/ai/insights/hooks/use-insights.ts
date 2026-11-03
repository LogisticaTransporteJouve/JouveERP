"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  ignoreInsightAction,
  listInsightsAction,
  runAnalystAction,
  setInsightStatusAction,
} from "../actions";
import type { IgnoreInsightInput } from "../lib/ignore-schema";
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
    mutationFn: (input: { id: string; status: "acknowledged" }) =>
      runAction(() => setInsightStatusAction(input)),
    // Settled: a refusal on a recalculated card must still load the new one.
    onSettled: () => {
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

export function useIgnoreInsight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: IgnoreInsightInput) =>
      runAction(() => ignoreInsightAction(input)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: insightsKeys.list() });
    },
  });
}
