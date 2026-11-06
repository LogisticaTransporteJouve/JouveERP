"use client";

import { useSuspenseQuery } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  getArcaReconciliationDetailAction,
  getArcaReconciliationMonthsAction,
} from "../actions/arca-reconciliation-actions";
import { arcaReceivedKeys } from "../lib/purchase-invoices-keys";

export function useArcaReconciliationMonths() {
  return useSuspenseQuery({
    queryKey: arcaReceivedKeys.reconciliation(),
    queryFn: () => runAction(() => getArcaReconciliationMonthsAction()),
  });
}

export function useArcaReconciliationDetail(period: string) {
  return useSuspenseQuery({
    queryKey: arcaReceivedKeys.reconciliationDetail(period),
    queryFn: () =>
      runAction(() => getArcaReconciliationDetailAction({ period })),
  });
}
