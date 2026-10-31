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
  createTripAction,
  deleteTripAction,
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

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  invalidateKeys(qc, [tripsKeys.all, fleetReportsKeys.all]);
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
