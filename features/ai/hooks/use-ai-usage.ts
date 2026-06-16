"use client";

import { useQuery } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import { getAiUsageTodayAction } from "../actions/usage-actions";
import { aiKeys } from "../lib/ai-keys";

const ONE_MINUTE = 60_000;

export function useAiUsageToday() {
  return useQuery({
    queryKey: aiKeys.usageToday(),
    queryFn: () => runAction(() => getAiUsageTodayAction()),
    staleTime: ONE_MINUTE,
  });
}
