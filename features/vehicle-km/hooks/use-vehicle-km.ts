"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  deleteVehicleKmReadingAction,
  getVehicleKmMonthAction,
  saveVehicleKmReadingAction,
} from "../actions/vehicle-km-actions";
import { vehicleKmKeys } from "../lib/vehicle-km-keys";
import type { KmReadingSaveInput } from "../schema";

export function useVehicleKmMonth(period: string) {
  return useSuspenseQuery({
    queryKey: vehicleKmKeys.month(period),
    queryFn: () => runAction(() => getVehicleKmMonthAction({ period })),
  });
}

export function useSaveKmReading() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: KmReadingSaveInput) =>
      runAction(() => saveVehicleKmReadingAction(input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: vehicleKmKeys.all }),
  });
}

export function useDeleteKmReading() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => deleteVehicleKmReadingAction({ id })),
    onSuccess: () => qc.invalidateQueries({ queryKey: vehicleKmKeys.all }),
  });
}
