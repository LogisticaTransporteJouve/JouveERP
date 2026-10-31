"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  createChartAccountAction,
  deleteChartAccountAction,
  listChartOfAccountsAction,
  updateChartAccountAction,
} from "../actions/chart-of-accounts-actions";
import { chartOfAccountsKeys } from "../lib/chart-of-accounts-keys";

export function useChartOfAccounts(options: { onlyActive?: boolean } = {}) {
  const onlyActive = options.onlyActive ?? false;
  return useSuspenseQuery({
    queryKey: chartOfAccountsKeys.list(onlyActive),
    queryFn: () => runAction(() => listChartOfAccountsAction({ onlyActive })),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: chartOfAccountsKeys.all });
}

export function useCreateChartAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createChartAccountAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateChartAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updateChartAccountAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteChartAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => deleteChartAccountAction({ id })),
    onSuccess: () => invalidate(qc),
  });
}
