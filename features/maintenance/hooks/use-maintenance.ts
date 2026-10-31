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
  createMaintenanceAction,
  deleteMaintenanceAction,
  listMaintenanceAction,
  updateMaintenanceAction,
} from "../actions/maintenance-actions";
import { maintenanceKeys } from "../lib/maintenance-keys";

export function useMaintenance() {
  return useSuspenseQuery({
    queryKey: maintenanceKeys.list(),
    queryFn: () => runAction(() => listMaintenanceAction()),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  invalidateKeys(qc, [maintenanceKeys.all, fleetReportsKeys.all]);
}

export function useCreateMaintenance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createMaintenanceAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateMaintenance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updateMaintenanceAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteMaintenance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => deleteMaintenanceAction({ id })),
    onSuccess: () => invalidate(qc),
  });
}
