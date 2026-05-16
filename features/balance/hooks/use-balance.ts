"use client";

import { useSuspenseQuery } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import { getAccountBalancesAction } from "../actions/balance-actions";
import { balanceKeys } from "../lib/balance-keys";

export function useAccountBalances(
  periodEnd: string,
  periodStart: string | null,
) {
  return useSuspenseQuery({
    queryKey: balanceKeys.saldos(periodEnd, periodStart),
    queryFn: () =>
      runAction(() =>
        getAccountBalancesAction({
          periodEnd,
          periodStart: periodStart ?? undefined,
        }),
      ),
  });
}
