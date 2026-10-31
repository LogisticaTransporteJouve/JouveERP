"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { fleetReportsKeys } from "@/features/fleet-reports/lib/fleet-reports-keys";
import { invalidateKeys } from "@/lib/query/invalidate";
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
  invalidateKeys(qc, [fuelKeys.all, fleetReportsKeys.all]);
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
