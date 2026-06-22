"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  createDriverAction,
  deleteDriverAction,
  listDriversAction,
  setDriverActiveAction,
  updateDriverAction,
} from "../actions/drivers-actions";
import { driversKeys } from "../lib/drivers-keys";

export function useDrivers(options: { onlyActive?: boolean } = {}) {
  const onlyActive = options.onlyActive ?? false;
  return useSuspenseQuery({
    queryKey: driversKeys.list(onlyActive),
    queryFn: () => runAction(() => listDriversAction({ onlyActive })),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: driversKeys.all });
}

export function useCreateDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => createDriverAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => updateDriverAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useSetDriverActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; is_active: boolean }) =>
      runAction(() => setDriverActiveAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runAction(() => deleteDriverAction({ id })),
    onSuccess: () => invalidate(qc),
  });
}
