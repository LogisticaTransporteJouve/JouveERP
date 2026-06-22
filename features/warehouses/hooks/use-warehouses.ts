"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  createWarehouseAction,
  deleteWarehouseAction,
  listWarehousesAction,
  setWarehouseActiveAction,
  updateWarehouseAction,
} from "../actions/warehouses-actions";
import { warehousesKeys } from "../lib/warehouses-keys";

export function useWarehouses(options: { onlyActive?: boolean } = {}) {
  const onlyActive = options.onlyActive ?? false;
  return useSuspenseQuery({
    queryKey: warehousesKeys.list(onlyActive),
    queryFn: () => runAction(() => listWarehousesAction({ onlyActive })),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: warehousesKeys.all });
}

export function useCreateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createWarehouseAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updateWarehouseAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useSetWarehouseActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; is_active: boolean }) =>
      runAction(() => setWarehouseActiveAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runAction(() => deleteWarehouseAction({ id })),
    onSuccess: () => invalidate(qc),
  });
}
