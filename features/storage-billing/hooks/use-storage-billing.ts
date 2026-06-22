"use client";

import { useQuery } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import { getStorageBillingAction } from "../actions/billing-actions";
import { storageBillingKeys } from "../lib/storage-billing-keys";

export function useStorageBilling(periodStart: string, periodEnd: string) {
  return useQuery({
    queryKey: storageBillingKeys.report(periodStart, periodEnd),
    queryFn: () =>
      runAction(() => getStorageBillingAction({ periodStart, periodEnd })),
    enabled: Boolean(periodStart) && Boolean(periodEnd),
  });
}
