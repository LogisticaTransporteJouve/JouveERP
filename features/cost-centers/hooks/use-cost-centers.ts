"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  createCostCenterAction,
  deleteCostCenterAction,
  listCostCentersAction,
  updateCostCenterAction,
} from "../actions/cost-centers-actions";
import { listCostTagOptionsAction } from "../actions/cost-tag-options-actions";
import { costCentersKeys } from "../lib/cost-centers-keys";

export function useCostCenters(options: { onlyActive?: boolean } = {}) {
  const onlyActive = options.onlyActive ?? false;
  return useSuspenseQuery({
    queryKey: costCentersKeys.list(onlyActive),
    queryFn: () => runAction(() => listCostCentersAction({ onlyActive })),
  });
}

/** Options of the expense-account and cost-center pickers. Not suspense: the
 *  pickers are optional fields inside forms that render without them. */
export function useCostTagOptions() {
  return useQuery({
    queryKey: costCentersKeys.tagOptions(),
    queryFn: () => runAction(() => listCostTagOptionsAction()),
    staleTime: 5 * 60_000,
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: costCentersKeys.all });
}

export function useCreateCostCenter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createCostCenterAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateCostCenter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updateCostCenterAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteCostCenter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runAction(() => deleteCostCenterAction({ id })),
    onSuccess: () => invalidate(qc),
  });
}
