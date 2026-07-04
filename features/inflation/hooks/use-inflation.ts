"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  applyInflationAdjustmentAction,
  createInflationAdjustmentAction,
  deleteInflationAdjustmentAction,
  listInflationAdjustmentsAction,
  revertInflationApplicationAction,
} from "../actions/inflation-actions";
import { inflationKeys } from "../lib/inflation-keys";

export function useInflationAdjustments() {
  return useSuspenseQuery({
    queryKey: inflationKeys.list(),
    queryFn: () => runAction(() => listInflationAdjustmentsAction()),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: inflationKeys.all });
}

export function useCreateInflationAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createInflationAdjustmentAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteInflationAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => deleteInflationAdjustmentAction({ id })),
    onSuccess: () => invalidate(qc),
  });
}

export function useApplyInflationAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; journal_entry_id: string }) =>
      runAction(() => applyInflationAdjustmentAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useRevertInflationApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => revertInflationApplicationAction({ id })),
    onSuccess: () => invalidate(qc),
  });
}
