"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  createVehicleAction,
  deleteVehicleAction,
  listVehiclesAction,
  setVehicleActiveAction,
  updateVehicleAction,
} from "../actions/vehicles-actions";
import { vehiclesKeys } from "../lib/vehicles-keys";

export function useVehicles(options: { onlyActive?: boolean } = {}) {
  const onlyActive = options.onlyActive ?? false;
  return useSuspenseQuery({
    queryKey: vehiclesKeys.list(onlyActive),
    queryFn: () => runAction(() => listVehiclesAction({ onlyActive })),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: vehiclesKeys.all });
}

export function useCreateVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => createVehicleAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => updateVehicleAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useSetVehicleActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; is_active: boolean }) =>
      runAction(() => setVehicleActiveAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runAction(() => deleteVehicleAction({ id })),
    onSuccess: () => invalidate(qc),
  });
}
