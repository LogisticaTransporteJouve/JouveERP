"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { shipmentsKeys } from "@/features/shipments/lib/shipments-keys";
import { runAction } from "@/lib/query/run-action";

import {
  createTripAction,
  deleteTripAction,
  listTripCompanionOptionsAction,
  listTripsAction,
  updateTripAction,
} from "../actions/trips-actions";
import { tripsKeys } from "../lib/trips-keys";

export function useTrips() {
  return useSuspenseQuery({
    queryKey: tripsKeys.list(),
    queryFn: () => runAction(() => listTripsAction()),
  });
}

/** Active employees for the Acompañante select, read when the form opens. */
export function useTripCompanionOptions(enabled: boolean) {
  return useQuery({
    queryKey: tripsKeys.companionOptions(),
    queryFn: () => runAction(() => listTripCompanionOptionsAction()),
    enabled,
  });
}

// A trip's date, status or deletion moves its cargas' status, and «Nuevo
// viaje» assigns cargas: both lists refresh.
function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: tripsKeys.all });
  qc.invalidateQueries({ queryKey: shipmentsKeys.all });
}

export function useCreateTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => createTripAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => updateTripAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runAction(() => deleteTripAction({ id })),
    onSuccess: () => invalidate(qc),
  });
}
