"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  closeAccountingPeriodAction,
  listClosedPeriodsAction,
  reopenAccountingPeriodAction,
} from "../actions/period-close-actions";
import { journalEntriesKeys } from "../lib/journal-entries-keys";

/** Fetched when the dialog opens, like the postable accounts. */
export function useClosedPeriods(enabled: boolean) {
  return useQuery({
    queryKey: journalEntriesKeys.closedPeriods(),
    queryFn: () => runAction(() => listClosedPeriodsAction()),
    enabled,
  });
}

export function useCloseAccountingPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (period: string) =>
      runAction(() => closeAccountingPeriodAction(period)),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: journalEntriesKeys.closedPeriods() }),
  });
}

export function useReopenAccountingPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (period: string) =>
      runAction(() => reopenAccountingPeriodAction(period)),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: journalEntriesKeys.closedPeriods() }),
  });
}
