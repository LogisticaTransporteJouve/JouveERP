"use client";

import { useSuspenseQuery } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import { getMonthlyPackageStatusAction } from "../actions/monthly-package-actions";
import { monthlyPackageKeys } from "../lib/monthly-package-keys";

export function useMonthlyPackageStatus(period: string) {
  return useSuspenseQuery({
    queryKey: monthlyPackageKeys.status(period),
    queryFn: () => runAction(() => getMonthlyPackageStatusAction(period)),
  });
}
