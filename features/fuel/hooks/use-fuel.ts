"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  createFuelLoadAction,
  deleteFuelLoadAction,
  listFuelLoadsAction,
  updateFuelLoadAction,
} from "../actions/fuel-actions";
import { fuelKeys } from "../lib/fuel-keys";

export function useFuelLoads() {
  return useSuspenseQuery({
    queryKey: fuelKeys.list(),
    queryFn: () => runAction(() => listFuelLoadsAction()),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: fuelKeys.all });
}

export function useCreateFuelLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createFuelLoadAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateFuelLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updateFuelLoadAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteFuelLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runAction(() => deleteFuelLoadAction({ id })),
    onSuccess: () => invalidate(qc),
  });
}
