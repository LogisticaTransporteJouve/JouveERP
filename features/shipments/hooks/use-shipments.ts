"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  changeShipmentStatusAction,
  createShipmentAction,
  deleteShipmentAction,
  listShipmentHistoryAction,
  listShipmentsAction,
  listShipmentsByTripAction,
  listUnassignedShipmentsAction,
  setShipmentsTripAction,
  updateShipmentAction,
} from "../actions/shipments-actions";
import { shipmentsKeys } from "../lib/shipments-keys";
import type { ShipmentListFilter } from "../schema";

/** The cargas list narrowed by `filter` (the Cargas toolbar's). */
export function useShipments(filter: ShipmentListFilter = {}) {
  return useSuspenseQuery({
    queryKey: shipmentsKeys.list(filter),
    queryFn: () => runAction(() => listShipmentsAction(filter)),
  });
}

export function useShipmentsByTrip(tripId: string | null) {
  return useQuery({
    queryKey: shipmentsKeys.byTrip(tripId ?? "none"),
    queryFn: () => runAction(() => listShipmentsByTripAction(tripId ?? "")),
    enabled: tripId !== null,
  });
}

/** Cargas without a trip, fetched when the "Asignar cargas" dialog opens. */
export function useUnassignedShipments(enabled: boolean) {
  return useQuery({
    queryKey: shipmentsKeys.unassigned(),
    queryFn: () => runAction(() => listUnassignedShipmentsAction()),
    enabled,
  });
}

export function useSetShipmentsTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { tripId: string | null; shipmentIds: string[] }) =>
      runAction(() => setShipmentsTripAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useShipmentHistory(id: string | null) {
  return useQuery({
    queryKey: shipmentsKeys.history(id ?? "none"),
    queryFn: () => runAction(() => listShipmentHistoryAction(id ?? "")),
    enabled: id !== null,
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: shipmentsKeys.all });
}

export function useCreateShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createShipmentAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updateShipmentAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useChangeShipmentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => changeShipmentStatusAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runAction(() => deleteShipmentAction({ id })),
    onSuccess: () => invalidate(qc),
  });
}
