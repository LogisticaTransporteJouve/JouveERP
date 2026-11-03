"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  createStorageAreaAction,
  deleteStorageAreaAction,
  listStorageAreasAction,
  updateStorageAreaAction,
} from "../actions/storage-areas-actions";
import { storageAreasKeys } from "../lib/warehouses-keys";
import type { StorageAreaCreateInput, StorageAreaUpdateInput } from "../schema";

/** Every warehouse's areas (the callers filter by warehouse). */
export function useStorageAreas(options: { onlyActive?: boolean } = {}) {
  const onlyActive = options.onlyActive ?? false;
  return useSuspenseQuery({
    queryKey: storageAreasKeys.list(onlyActive),
    queryFn: () => runAction(() => listStorageAreasAction({ onlyActive })),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: storageAreasKeys.all });
}

export function useCreateStorageArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StorageAreaCreateInput) =>
      runAction(() => createStorageAreaAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateStorageArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StorageAreaUpdateInput) =>
      runAction(() => updateStorageAreaAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteStorageArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => deleteStorageAreaAction({ id })),
    onSuccess: () => invalidate(qc),
  });
}
