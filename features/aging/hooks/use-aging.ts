"use client";

import { useSuspenseQuery } from "@tanstack/react-query";

import { useScopeIsFiscal } from "@/components/providers/scope-provider";
import { runAction } from "@/lib/query/run-action";

import { getAgingSummaryAction } from "../actions/aging-actions";
import { agingKeys } from "../lib/aging-keys";

export function useAgingSummary() {
  const isFiscal = useScopeIsFiscal();
  return useSuspenseQuery({
    queryKey: agingKeys.summary(isFiscal),
    queryFn: () => runAction(() => getAgingSummaryAction({ isFiscal })),
  });
}
